import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Validator, childPath } from '../core/config'
import { git, gitStatus, gitToplevel } from '../core/git'
import { createMatcher } from '../core/glob'
import { parseJsonc } from '../core/jsonc'
import { jigPaths, resolvePluginRoot, toSlash } from '../core/paths'
import { realPath } from '../core/proc'
import { fileSource, isTestFile } from '../catalog/languages'
import { lexComments } from '../catalog/languages'
import { detectAgent, loadUserConfig, resolveTiers, type TierMap } from '../tiers/tiers'
import {
  AUTO_INLINE_MAX_N,
  CEILINGS,
  EFFORTS,
  GRADE_KEYS,
  LAYOUTS,
  LINES_PER_FINDER,
  MAX_FINDERS,
  MAX_PARALLEL,
  MODES,
  angleNumber,
  isLayout,
  isTier,
  judgeModels,
  planReview,
  stepsFor,
  type Angle,
  type AngleSettings,
  type Grade,
  type JudgeModel,
  type ConcreteLayout,
  type Layout,
  type Mode,
  type Plan,
  type SelectorSource,
  type Shape,
  type StepRef,
} from './layout'

type Command = (args: string[]) => number | Promise<number>

export interface FileStat {
  path: string
  added: number
  deleted: number
}

export type Exclusion = 'test' | 'fixture' | 'markdown'

export const PROJECT_CONFIG = 'review.jsonc'

const isTestPath = createMatcher(['**/{test,tests,__tests__}/**'])
const isFixturePath = createMatcher(['**/{fixture,fixtures,__fixtures__,__snapshots__}/**', '**/*.snap'])
const isMarkdown = createMatcher(['**/*.md'])
const isChangelog = createMatcher(['**/CHANGELOG.md'])

export const exclusionOf = (path: string, root?: string): Exclusion | undefined => {
  if (isMarkdown(path)) return 'markdown'
  if (isTestFile(path, root === undefined ? undefined : fileSource(root, path)) || isTestPath(path)) return 'test'
  if (isFixturePath(path)) return 'fixture'
  return undefined
}

export const parseNumstat = (output: string): FileStat[] => {
  const tokens = output.split('\0')
  const stats: FileStat[] = []
  for (let index = 0; index < tokens.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[index] ?? '')
    if (match === null) continue
    let path = match[3] ?? ''
    if (path === '') {
      path = tokens[index + 2] ?? ''
      index += 2
    }
    const count = (value: string | undefined): number => (value === undefined || value === '-' ? 0 : Number(value))
    stats.push({ path, added: count(match[1]), deleted: count(match[2]) })
  }
  return stats
}

export const countLines = (stats: readonly FileStat[], root?: string): { lines: number; counted: number; excluded: Record<Exclusion, number> } => {
  const excluded: Record<Exclusion, number> = { test: 0, fixture: 0, markdown: 0 }
  let lines = 0
  let counted = 0
  for (const stat of stats) {
    const exclusion = exclusionOf(stat.path, root)
    if (exclusion !== undefined) {
      excluded[exclusion]++
      continue
    }
    lines += stat.added + stat.deleted
    counted++
  }
  return { lines, counted, excluded }
}

export const addedLines = (patch: string): Map<string, Set<number>> => {
  const files = new Map<string, Set<number>>()
  let current: Set<number> | undefined
  for (const line of patch.split('\n')) {
    const file = /^\+\+\+ (?:b\/)?(.*)$/.exec(line)
    if (file !== null) {
      const path = file[1] ?? ''
      current = path === '/dev/null' ? undefined : new Set()
      if (current !== undefined) files.set(path, current)
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk === null || current === undefined) continue
    const start = Number(hunk[1])
    const length = hunk[2] === undefined ? 1 : Number(hunk[2])
    for (let offset = 0; offset < length; offset++) current.add(start + offset)
  }
  return files
}

export const hasAddedComment = (file: string, source: string, added: ReadonlySet<number>): boolean => {
  const comments = lexComments(file, source) ?? []
  return comments.some((comment) => {
    const last = comment.line + (comment.text.match(/\n/g)?.length ?? 0)
    for (let line = comment.line; line <= last; line++) {
      if (added.has(line)) return true
    }
    return false
  })
}

export interface ProjectReviewConfig {
  layout: Layout | undefined
  angles: Partial<Record<Angle, AngleSettings>>
  grades: Record<string, Grade>
  maxParallel: number
}

const PROJECT_KEYS = ['$schema', 'iterationsMemory', 'discover', 'review', 'severity', 'route', 'angles', 'tiers', 'maxParallel', 'layout']

const readAngles = (validator: Validator, value: unknown): Partial<Record<Angle, AngleSettings>> => {
  const object = validator.object(value, '$.angles', undefined)
  if (object === undefined) return {}
  const angles: Partial<Record<Angle, AngleSettings>> = {}
  for (const [key, entry] of Object.entries(object)) {
    const path = childPath('$.angles', key)
    const angle = angleNumber(key)
    if (angle === undefined) {
      validator.report(path, 'expected an angle number 1..17')
      continue
    }
    const settings = validator.object(entry, path, ['enabled', 'severityCeiling'])
    if (settings === undefined) continue
    const parsed: AngleSettings = {}
    if (settings['enabled'] !== undefined) {
      if (typeof settings['enabled'] === 'boolean') parsed.enabled = settings['enabled']
      else validator.report(childPath(path, 'enabled'), 'expected a boolean')
    }
    if (settings['severityCeiling'] !== undefined) {
      const ceiling = validator.oneOf(settings['severityCeiling'], childPath(path, 'severityCeiling'), CEILINGS)
      if (ceiling !== undefined) parsed.severityCeiling = ceiling
    }
    angles[angle] = parsed
  }
  return angles
}

const readGrades = (validator: Validator, value: unknown): Record<string, Grade> => {
  const object = validator.object(value, '$.tiers', GRADE_KEYS)
  if (object === undefined) return {}
  const grades: Record<string, Grade> = {}
  for (const [key, entry] of Object.entries(object)) {
    const path = childPath('$.tiers', key)
    const grade = validator.object(entry, path, ['tier', 'effort'])
    if (grade === undefined) continue
    const tier = validator.string(grade['tier'], childPath(path, 'tier'))
    const effort = validator.oneOf(grade['effort'], childPath(path, 'effort'), EFFORTS)
    if (tier !== undefined && !isTier(tier)) validator.report(childPath(path, 'tier'), 'expected one of deep, standard, fast')
    if (tier !== undefined && isTier(tier) && effort !== undefined) grades[key] = { tier, effort }
  }
  return grades
}

export const parseProjectConfig = (text: string, label: string): ProjectReviewConfig => {
  const validator = new Validator()
  const root = validator.object(parseJsonc(text), '$', PROJECT_KEYS)
  const angles = root?.['angles'] === undefined ? {} : readAngles(validator, root['angles'])
  const grades = root?.['tiers'] === undefined ? {} : readGrades(validator, root['tiers'])
  const maxParallel = root?.['maxParallel'] === undefined ? MAX_PARALLEL : validator.integer(root['maxParallel'], '$.maxParallel', 1)
  const layout = root?.['layout'] === undefined ? undefined : validator.oneOf(root['layout'], '$.layout', LAYOUTS)
  if (validator.errors.length > 0) throw new Error(`${label}: ${validator.errors.join('; ')}`)
  return { layout, angles, grades, maxParallel: maxParallel ?? MAX_PARALLEL }
}

const loadProjectConfig = (root: string): { label: string; config: ProjectReviewConfig } | undefined => {
  const path = join(jigPaths(root).dir, PROJECT_CONFIG)
  if (!existsSync(path)) return undefined
  const label = `.jig/${PROJECT_CONFIG}`
  return { label, config: parseProjectConfig(readFileSync(path, 'utf8'), label) }
}

const firstLine = (text: string): string | undefined => text.split('\n')[0]?.trim() || undefined

const gitLine = (args: string[], root: string): string | undefined => {
  const result = git(args, root)
  return result.ok ? firstLine(result.stdout) : undefined
}

export interface Base {
  ref: string
  mergeBase: string
  source: 'argument' | 'upstream' | 'origin-head'
  stats: FileStat[]
}

const pathspec = (paths: readonly string[]): string[] => (paths.length > 0 ? ['--', ...paths] : [])

const diffStats = (root: string, mergeBase: string, paths: readonly string[]): FileStat[] => {
  const result = git(['diff', '--numstat', '-M', '-z', mergeBase, ...pathspec(paths)], root)
  if (!result.ok) throw new Error(`git diff --numstat failed: ${result.stderr.trim()}`)
  return parseNumstat(result.stdout)
}

export const resolveBase = (root: string, given: string | undefined, command = 'review-plan', paths: readonly string[] = []): Base => {
  const candidates: { ref: string | undefined; source: Base['source'] }[] = given
    ? [{ ref: given, source: 'argument' }]
    : [
        { ref: gitLine(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], root), source: 'upstream' },
        { ref: gitLine(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root), source: 'origin-head' },
      ]
  let last: Base | undefined
  for (const { ref, source } of candidates) {
    if (ref === undefined) continue
    const mergeBase = gitLine(['merge-base', ref, 'HEAD'], root)
    if (mergeBase === undefined) {
      if (source === 'argument') throw new Error(`no merge base between ${ref} and HEAD`)
      continue
    }
    last = { ref, mergeBase, source, stats: diffStats(root, mergeBase, paths) }
    if (last.stats.length > 0) return last
  }
  if (last !== undefined) return last
  throw new Error(`no base: pass the merge request target, e.g. jig ${command} origin/main`)
}

const addedNewSourceFiles = (root: string, mergeBase: string, paths: readonly string[]): number => {
  const result = git(['diff', '--name-only', '--diff-filter=A', '-M', '-z', mergeBase, ...pathspec(paths)], root)
  if (!result.ok) return 0
  return result.stdout.split('\0').filter((path) => path !== '' && exclusionOf(path, root) === undefined).length
}

const anyAddedComment = (root: string, mergeBase: string, stats: readonly FileStat[]): boolean => {
  const candidates = stats.filter((stat) => stat.added > 0 && lexComments(stat.path, '') !== undefined).map((stat) => stat.path)
  if (candidates.length === 0) return false
  const result = git(['diff', '-U0', '-M', '--no-color', '--no-ext-diff', mergeBase, '--', ...candidates], root)
  if (!result.ok) return false
  for (const [file, lines] of addedLines(result.stdout)) {
    const path = join(root, file)
    if (lines.size > 0 && existsSync(path) && hasAddedComment(file, readFileSync(path, 'utf8'), lines)) return true
  }
  return false
}

const untrackedCount = (root: string, paths: readonly string[]): number =>
  (gitStatus(root, paths) ?? []).filter((entry) => entry.status === '??').length

const shellWord = (word: string): string => (/^[\w./:@=+-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

export const diffCommand = (mergeBase: string, paths: readonly string[]): string =>
  ['git', 'diff', mergeBase, ...pathspec(paths)].map(shellWord).join(' ')

/** Files a reader of some angles reads before the hunt: the angle files and the atoms they name, absolute. */
export interface Reads {
  angles: string[]
  atoms: string[]
}

export interface ReviewPlanReport {
  base: { ref: string; mergeBase: string; source: Base['source'] }
  files: { counted: number; excluded: Record<Exclusion, number>; untracked: number }
  scope: string[]
  diff: string
  formula: string
  layout: { name: Layout; source: LayoutSource }
  shape: Shape
  plan: Plan
  mode: Mode
  state: boolean
  skill: string
  steps: StepRef[]
  reads: Record<string, Reads>
  maxParallel: number
  config: string | null
  agent: string
  models: TierMap | undefined
  finderModels: Record<string, string | undefined>
  judge: JudgeModel[]
}

export const INLINE_READER = 'inline'
export const LAYOUT_ENV = 'JIG_REVIEW_LAYOUT'
export const DEFAULT_LAYOUT: Layout = 'auto'

export type LayoutSource = 'argument' | 'env' | 'config' | 'default'

export const resolveLayout = (argument: string | undefined, env: string | undefined, config: Layout | undefined): { name: Layout; source: LayoutSource } => {
  const given: [string | undefined, LayoutSource, string][] = [
    [argument, 'argument', '--layout'],
    [env, 'env', LAYOUT_ENV],
  ]
  for (const [value, source, label] of given) {
    if (value === undefined || value === '') continue
    if (!isLayout(value)) throw new Error(`unknown layout ${value} in ${label}; expected one of ${LAYOUTS.join(', ')}`)
    return { name: value, source }
  }
  return config === undefined ? { name: DEFAULT_LAYOUT, source: 'default' } : { name: config, source: 'config' }
}

/** The atom names an angle file declares in its `**Atom:**` / `**Atoms:**` header. */
export const angleAtoms = (text: string): string[] => {
  const header = /\*\*Atoms?:\*\*([^\n]*)/.exec(text)?.[1] ?? ''
  return [...header.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '').filter((name) => name !== '')
}

export const readsFor = (pluginRoot: string, angles: readonly Angle[]): Reads => {
  const angleDir = join(pluginRoot, 'skills', 'jig-review', 'angles')
  const atomDir = join(pluginRoot, 'atoms')
  const names = existsSync(angleDir) ? readdirSync(angleDir) : []
  const files = angles.flatMap((angle) => names.filter((name) => name.startsWith(`${angle}.`) && name.endsWith('.md')).map((name) => join(angleDir, name)))
  const atoms = [...new Set(files.flatMap((file) => angleAtoms(readFileSync(file, 'utf8'))))].map((name) => join(atomDir, `${name}.md`)).filter((path) => existsSync(path))
  return { angles: files.map(toSlash), atoms: atoms.map(toSlash) }
}

const angleList = (angles: readonly number[]): string => angles.join('+')

const gradeText = (grade: Grade, models: TierMap | undefined): string => {
  const model = models?.[grade.tier]?.[0]
  return `${grade.tier}/${grade.effort}${model === undefined ? '' : ` ${model}`}`
}

const SELECTOR_NOTES: Readonly<Record<SelectorSource, string>> = {
  argument: '',
  default: ' (default)',
  'small-diff': ' (default on the inline path; --selector full for every angle)',
}

const LAYOUT_SOURCE_TEXT: Readonly<Record<LayoutSource, string>> = { argument: '--layout', env: LAYOUT_ENV, config: `.jig/${PROJECT_CONFIG}`, default: 'default' }

const LAYOUT_TEXT: Readonly<Record<ConcreteLayout, string>> = {
  inline: 'the session hunts and judges; a judge subagent only for Important',
  fanout: 'finders by LINES on their angle tiers, a judge per cluster on the other model',
  lean: 'finders by LINES on the standard tier; you judge, a deep judge only for Important',
  solo: 'finders by LINES on the deep tier prove their own candidates; no judge subagents',
}

const layoutLine = (report: ReviewPlanReport): string => {
  const { name, source } = report.layout
  const resolved = report.plan.layout
  const chosen = name === 'auto' ? `auto → ${resolved} (inline up to N = ${AUTO_INLINE_MAX_N}, lean above)` : resolved
  return `layout: ${chosen}${source === 'default' ? ' (default)' : ` (from ${LAYOUT_SOURCE_TEXT[source]})`} · ${LAYOUT_TEXT[resolved]}`
}

const stateText = (report: ReviewPlanReport): string => {
  if (report.state) return 'on (merge request known: state file, comment texts, re-review)'
  if (report.mode === 'pre-mr') return 'off (mode pre-mr: track progress in your todo list)'
  return 'off (no merge request or --no-state: no state file, no comment texts, no posting)'
}

const readLines = (reads: Reads | undefined): string[] =>
  reads === undefined ? [] : [`  read: ${reads.angles.join(' ')}`, ...(reads.atoms.length > 0 ? [`  atoms: ${reads.atoms.join(' ')}`] : [])]

export const formatReport = (report: ReviewPlanReport): string => {
  const { plan, models } = report
  const excluded = Object.entries(report.files.excluded)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`)
  const lines = [
    `base: ${report.base.ref} (merge base ${report.base.mergeBase.slice(0, 8)}, from ${report.base.source})`,
    `lines: ${plan.lines} in ${report.files.counted} files${report.scope.length > 0 ? ` (scope: ${report.scope.join(' ')})` : ''}${excluded.length > 0 ? `; excluded: ${excluded.join(', ')}` : ''}${report.files.untracked > 0 ? `; untracked files not counted: ${report.files.untracked} (git add -N to count them)` : ''}`,
    `diff: ${report.diff}`,
    `finders: ${report.formula}`,
    layoutLine(report),
    `shape: tests ${report.shape.tests ? 'yes' : 'no'} · added comments ${report.shape.comments ? 'yes' : 'no'} · markdown ${report.shape.docs ? 'yes' : 'no'} · new source files ${report.shape.newSourceFiles} · spec ${report.shape.spec ? 'yes' : 'no'}`,
    `selector: ${plan.selection.input}${plan.selection.tokens.length > 0 && plan.selection.input !== plan.selection.tokens.join(',') ? ` → ${plan.selection.tokens.join(',')}` : ''}${SELECTOR_NOTES[plan.selection.source]}`,
    `config: ${report.config ?? 'default'} · agent: ${report.agent} · max parallel subagents: ${report.maxParallel}`,
    `mode: ${report.mode} · state: ${stateText(report)}`,
    '',
  ]
  if (plan.path === 'none') lines.push('finders: none (nothing to review)')
  if (plan.path === 'inline') {
    lines.push(`path: inline: review in this session, angles ${angleList(plan.angles)}; no finder subagents; no judge subagents unless an Important candidate survives your own gates`)
    lines.push(...readLines(report.reads[INLINE_READER]))
  }
  for (const finder of plan.finders) {
    lines.push(`finder ${finder.name}: angles ${angleList(finder.angles)} · ${gradeText(finder, models)}`)
    lines.push(...readLines(report.reads[finder.name]))
  }
  if (plan.deepening !== undefined) lines.push(`deepening: ${gradeText(plan.deepening, models)}`)
  if (plan.path === 'inline') {
    lines.push(`judge for Important candidates: one subagent, ${plan.verify.tier}/${plan.verify.effort}`)
    for (const judge of report.judge) {
      lines.push(`  your model ${judge.finderModel} → judge ${judge.judgeModel}${judge.same ? ' (same model: one model in the tier)' : ''}`)
    }
  } else if (plan.judging === 'self') {
    lines.push('verify: no judge subagents; every finder proves its own candidates, you dedup and apply the verdicts')
  } else if (plan.judging === 'important') {
    lines.push(`verify: you judge every candidate by the gate files; one judge subagent for the Important ones, ${plan.verify.tier}/${plan.verify.effort}`)
    for (const judge of report.judge) {
      lines.push(`  candidates from ${judge.finderModel} → judge ${judge.judgeModel}${judge.same ? ' (same model: one model in the tier)' : ''}`)
    }
  } else {
    lines.push(`verify: ${plan.verify.tier}/${plan.verify.effort}`)
    for (const judge of report.judge) {
      lines.push(`  candidates from ${judge.finderModel} → judge ${judge.judgeModel}${judge.same ? ' (same model: one model in the tier)' : ''}`)
    }
  }
  if (report.judge.length === 0 && plan.judging !== 'self') lines.push(`  judge: a ${plan.verify.tier} model other than the finder's`)
  lines.push(`outcome check: ${gradeText(plan.outcome, models)} · composer: ${gradeText(plan.composer, models)}`)
  if (plan.skipped.length > 0) {
    lines.push(`skipped angles: ${plan.skipped.map((skip) => `${skip.angle} (${skip.reason})`).join(', ')}`)
  }
  lines.push(`output filter: ${plan.outputTokens.length > 0 ? plan.outputTokens.join(',') : 'all findings'}`)
  lines.push('', 'steps for this run (read each when you reach it; no other step file applies):')
  lines.push(...report.steps.map((step) => `  ${report.skill}/${step.file}${step.when === undefined ? '' : ` · ${step.when}`}`))
  return lines.join('\n')
}

export interface ReportOptions {
  base?: string | undefined
  selector?: string | undefined
  layout?: string | undefined
  layoutEnv?: string | undefined
  spec: boolean
  agent?: string | undefined
  mode?: Mode
  mergeRequest?: boolean
  noState?: boolean
  pluginRoot?: string
  paths?: readonly string[]
}

export const buildReport = (root: string, options: ReportOptions): ReviewPlanReport => {
  const paths = options.paths ?? []
  const base = resolveBase(root, options.base, 'review-plan', paths)
  const untracked = untrackedCount(root, paths)
  requireScopedChanges(paths, base.stats.length + untracked, base.ref)
  const { lines, counted, excluded } = countLines(base.stats, root)
  const changed = base.stats.filter((stat) => stat.added > 0)
  const shape: Shape = {
    tests: changed.some((stat) => exclusionOf(stat.path, root) === 'test'),
    comments: anyAddedComment(root, base.mergeBase, base.stats),
    docs: changed.some((stat) => exclusionOf(stat.path) === 'markdown' && !isChangelog(stat.path)),
    newSourceFiles: addedNewSourceFiles(root, base.mergeBase, paths),
    spec: options.spec,
  }
  const project = loadProjectConfig(root)
  const layout = resolveLayout(options.layout, options.layoutEnv, project?.config.layout)
  const plan = planReview({
    lines,
    shape,
    layout: layout.name,
    selector: options.selector,
    angles: project?.config.angles ?? {},
    grades: project?.config.grades ?? {},
  })
  const loaded = loadUserConfig()
  if (loaded.error !== undefined) throw new Error(`${loaded.label}: ${loaded.error}`)
  const agent = detectAgent(options.agent)
  const models = resolveTiers(agent, loaded.config)
  const finderModels = Object.fromEntries(plan.finders.map((finder) => [finder.name, models?.[finder.tier]?.[0]]))
  const verifyModels = models?.[plan.verify.tier] ?? []
  const usedModels = plan.path === 'inline' ? verifyModels : Object.values(finderModels).filter((model): model is string => model !== undefined)
  const mode = options.mode ?? 'review'
  const state = mode === 'review' && options.mergeRequest === true && options.noState !== true
  const pluginRoot = options.pluginRoot ?? resolvePluginRoot()
  const readers: [string, readonly Angle[]][] = plan.path === 'inline' ? [[INLINE_READER, plan.angles]] : plan.finders.map((finder) => [finder.name, finder.angles])
  return {
    base: { ref: base.ref, mergeBase: base.mergeBase, source: base.source },
    files: { counted, excluded, untracked },
    scope: [...paths],
    diff: diffCommand(base.mergeBase, paths),
    formula: `ceil(${lines}/${LINES_PER_FINDER}) = ${Math.ceil(lines / LINES_PER_FINDER)}, max ${MAX_FINDERS} → N = ${plan.n}`,
    layout,
    shape,
    plan,
    mode,
    state,
    skill: toSlash(join(pluginRoot, 'skills', 'jig-review')),
    steps: stepsFor(plan, mode, state),
    reads: Object.fromEntries(readers.map(([name, angles]) => [name, readsFor(pluginRoot, angles)])),
    maxParallel: project?.config.maxParallel ?? MAX_PARALLEL,
    config: project?.label ?? null,
    agent,
    models,
    finderModels,
    judge: plan.judging === 'self' ? [] : judgeModels(usedModels, verifyModels),
  }
}

const isMode = (value: string): value is Mode => (MODES as readonly string[]).includes(value)
const USAGE = 'usage: jig review-plan [<base>] [--selector full|quick|auto|<tokens>] [--layout auto|inline|fanout|lean|solo] [--spec] [--mode review|pre-mr] [--mr] [--no-state] [--agent <id>] [--json] [-- <pathspec>...]'

export const splitPathspec = (args: readonly string[]): { options: string[]; paths: string[] | undefined } => {
  const separator = args.indexOf('--')
  return separator === -1 ? { options: [...args], paths: undefined } : { options: args.slice(0, separator), paths: args.slice(separator + 1) }
}

export const toRootPaths = (root: string, cwd: string, paths: readonly string[]): string[] => {
  const from = realPath(cwd)
  return paths.map((path) => {
    if (path.startsWith(':')) return path
    const fromRoot = toSlash(relative(realPath(root), resolve(from, path)))
    if (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) throw new Error(`${path} is outside the repository`)
    return fromRoot === '' ? '.' : fromRoot
  })
}

export const requireScopedChanges = (paths: readonly string[], changed: number, baseRef: string): void => {
  if (paths.length > 0 && changed === 0) throw new Error(`nothing changed against ${baseRef} under ${paths.join(' ')}; paths after -- are relative to the current directory`)
}

export const runReviewPlan: Command = (args) => {
  const split = splitPathspec(args)
  if (split.paths?.length === 0) throw new Error(`no path after --; ${USAGE}`)
  const { values, positionals } = parseArgs({
    args: split.options,
    allowPositionals: true,
    strict: true,
    options: {
      selector: { type: 'string' },
      layout: { type: 'string' },
      spec: { type: 'boolean' },
      agent: { type: 'string' },
      mode: { type: 'string' },
      mr: { type: 'boolean' },
      'no-state': { type: 'boolean' },
      json: { type: 'boolean' },
    },
  })
  if (positionals.length > 1) throw new Error(USAGE)
  const mode = values.mode ?? 'review'
  if (!isMode(mode)) throw new Error(`unknown mode ${mode}; ${USAGE}`)
  const root = gitToplevel(process.cwd())
  if (root === undefined) throw new Error('not inside a git repository')
  const paths = toRootPaths(root, process.cwd(), split.paths ?? [])
  const report = buildReport(root, {
    base: positionals[0],
    selector: values.selector,
    layout: values.layout,
    layoutEnv: process.env[LAYOUT_ENV],
    spec: values.spec === true,
    agent: values.agent,
    mode,
    mergeRequest: values.mr === true,
    noState: values['no-state'] === true,
    paths,
  })
  process.stdout.write(`${values.json ? JSON.stringify(report) : formatReport(report)}\n`)
  return 0
}
