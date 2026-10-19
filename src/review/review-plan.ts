import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Validator, childPath } from '../core/config'
import { git, gitStatus, gitToplevel } from '../core/git'
import { createMatcher } from '../core/glob'
import { parseJsonc } from '../core/jsonc'
import { jigPaths } from '../core/paths'
import { isTestFile } from '../core/test-files'
import { lexComments } from '../rules/lexer'
import { detectAgent, loadUserConfig, resolveTiers, type TierMap } from '../tiers/tiers'
import {
  CEILINGS,
  EFFORTS,
  GRADE_KEYS,
  LINES_PER_FINDER,
  MAX_FINDERS,
  MAX_PARALLEL,
  angleNumber,
  isTier,
  judgeModels,
  planReview,
  type Angle,
  type AngleSettings,
  type Grade,
  type JudgeModel,
  type Plan,
  type Shape,
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

export const exclusionOf = (path: string): Exclusion | undefined => {
  if (isMarkdown(path)) return 'markdown'
  if (isTestFile(path) || isTestPath(path)) return 'test'
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

export const countLines = (stats: readonly FileStat[]): { lines: number; counted: number; excluded: Record<Exclusion, number> } => {
  const excluded: Record<Exclusion, number> = { test: 0, fixture: 0, markdown: 0 }
  let lines = 0
  let counted = 0
  for (const stat of stats) {
    const exclusion = exclusionOf(stat.path)
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
  angles: Partial<Record<Angle, AngleSettings>>
  grades: Record<string, Grade>
  maxParallel: number
}

const PROJECT_KEYS = ['$schema', 'iterationsMemory', 'discover', 'review', 'severity', 'route', 'angles', 'tiers', 'maxParallel']

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
  if (validator.errors.length > 0) throw new Error(`${label}: ${validator.errors.join('; ')}`)
  return { angles, grades, maxParallel: maxParallel ?? MAX_PARALLEL }
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

const diffStats = (root: string, mergeBase: string): FileStat[] => {
  const result = git(['diff', '--numstat', '-M', '-z', mergeBase], root)
  if (!result.ok) throw new Error(`git diff --numstat failed: ${result.stderr.trim()}`)
  return parseNumstat(result.stdout)
}

export const resolveBase = (root: string, given: string | undefined, command = 'review-plan'): Base => {
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
    last = { ref, mergeBase, source, stats: diffStats(root, mergeBase) }
    if (last.stats.length > 0) return last
  }
  if (last !== undefined) return last
  throw new Error(`no base: pass the merge request target, e.g. jig ${command} origin/main`)
}

const addedNewSourceFiles = (root: string, mergeBase: string): number => {
  const result = git(['diff', '--name-only', '--diff-filter=A', '-M', '-z', mergeBase], root)
  if (!result.ok) return 0
  return result.stdout.split('\0').filter((path) => path !== '' && exclusionOf(path) === undefined).length
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

const untrackedCount = (root: string): number => (gitStatus(root) ?? []).filter((entry) => entry.status === '??').length

export interface ReviewPlanReport {
  base: { ref: string; mergeBase: string; source: Base['source'] }
  files: { counted: number; excluded: Record<Exclusion, number>; untracked: number }
  formula: string
  shape: Shape
  plan: Plan
  maxParallel: number
  config: string | null
  agent: string
  models: TierMap | undefined
  finderModels: Record<string, string | undefined>
  judge: JudgeModel[]
}

const angleList = (angles: readonly number[]): string => angles.join('+')

const gradeText = (grade: Grade, models: TierMap | undefined): string => {
  const model = models?.[grade.tier]?.[0]
  return `${grade.tier}/${grade.effort}${model === undefined ? '' : ` ${model}`}`
}

export const formatReport = (report: ReviewPlanReport): string => {
  const { plan, models } = report
  const excluded = Object.entries(report.files.excluded)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`)
  const lines = [
    `base: ${report.base.ref} (merge base ${report.base.mergeBase.slice(0, 8)}, from ${report.base.source})`,
    `lines: ${plan.lines} in ${report.files.counted} files${excluded.length > 0 ? `; excluded: ${excluded.join(', ')}` : ''}${report.files.untracked > 0 ? `; untracked files not counted: ${report.files.untracked} (git add -N to count them)` : ''}`,
    `finders: ${report.formula}`,
    `shape: tests ${report.shape.tests ? 'yes' : 'no'} · added comments ${report.shape.comments ? 'yes' : 'no'} · markdown ${report.shape.docs ? 'yes' : 'no'} · new source files ${report.shape.newSourceFiles} · spec ${report.shape.spec ? 'yes' : 'no'}`,
    `selector: ${plan.selection.input}${plan.selection.tokens.length > 0 && plan.selection.input !== plan.selection.tokens.join(',') ? ` → ${plan.selection.tokens.join(',')}` : ''}`,
    `config: ${report.config ?? 'default'} · agent: ${report.agent} · max parallel subagents: ${report.maxParallel}`,
    '',
  ]
  if (plan.finders.length === 0) lines.push('finders: none (nothing to review)')
  for (const finder of plan.finders) {
    lines.push(`finder ${finder.name}: angles ${angleList(finder.angles)} · ${gradeText(finder, models)}`)
  }
  if (plan.deepening !== undefined) lines.push(`deepening: ${gradeText(plan.deepening, models)}`)
  lines.push(`verify: ${plan.verify.tier}/${plan.verify.effort}`)
  for (const judge of report.judge) {
    lines.push(`  candidates from ${judge.finderModel} → judge ${judge.judgeModel}${judge.same ? ' (same model: one model in the tier)' : ''}`)
  }
  if (report.judge.length === 0) lines.push(`  judge: a ${plan.verify.tier} model other than the finder's`)
  lines.push(`outcome check: ${gradeText(plan.outcome, models)} · composer: ${gradeText(plan.composer, models)}`)
  if (plan.skipped.length > 0) {
    lines.push(`skipped angles: ${plan.skipped.map((skip) => `${skip.angle} (${skip.reason})`).join(', ')}`)
  }
  lines.push(`output filter: ${plan.outputTokens.length > 0 ? plan.outputTokens.join(',') : 'all findings'}`)
  return lines.join('\n')
}

export const buildReport = (root: string, options: { base?: string | undefined; selector?: string | undefined; spec: boolean; agent?: string | undefined }): ReviewPlanReport => {
  const base = resolveBase(root, options.base)
  const { lines, counted, excluded } = countLines(base.stats)
  const changed = base.stats.filter((stat) => stat.added > 0)
  const shape: Shape = {
    tests: changed.some((stat) => exclusionOf(stat.path) === 'test'),
    comments: anyAddedComment(root, base.mergeBase, base.stats),
    docs: changed.some((stat) => exclusionOf(stat.path) === 'markdown' && !isChangelog(stat.path)),
    newSourceFiles: addedNewSourceFiles(root, base.mergeBase),
    spec: options.spec,
  }
  const project = loadProjectConfig(root)
  const plan = planReview({
    lines,
    shape,
    selector: options.selector,
    angles: project?.config.angles ?? {},
    grades: project?.config.grades ?? {},
  })
  const loaded = loadUserConfig()
  if (loaded.error !== undefined) throw new Error(`${loaded.label}: ${loaded.error}`)
  const agent = detectAgent(options.agent)
  const models = resolveTiers(agent, loaded.config)
  const finderModels = Object.fromEntries(plan.finders.map((finder) => [finder.name, models?.[finder.tier]?.[0]]))
  const usedModels = Object.values(finderModels).filter((model): model is string => model !== undefined)
  return {
    base: { ref: base.ref, mergeBase: base.mergeBase, source: base.source },
    files: { counted, excluded, untracked: untrackedCount(root) },
    formula: `ceil(${lines}/${LINES_PER_FINDER}) = ${Math.ceil(lines / LINES_PER_FINDER)}, max ${MAX_FINDERS} → N = ${plan.n}`,
    shape,
    plan,
    maxParallel: project?.config.maxParallel ?? MAX_PARALLEL,
    config: project?.label ?? null,
    agent,
    models,
    finderModels,
    judge: judgeModels(usedModels, models?.[plan.verify.tier] ?? []),
  }
}

export const runReviewPlan: Command = (args) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      selector: { type: 'string' },
      spec: { type: 'boolean' },
      agent: { type: 'string' },
      json: { type: 'boolean' },
    },
  })
  if (positionals.length > 1) throw new Error('usage: jig review-plan [<base>] [--selector full|quick|auto|<tokens>] [--spec] [--agent <id>] [--json]')
  const root = gitToplevel(process.cwd())
  if (root === undefined) throw new Error('not inside a git repository')
  const report = buildReport(root, { base: positionals[0], selector: values.selector, spec: values.spec === true, agent: values.agent })
  process.stdout.write(`${values.json ? JSON.stringify(report) : formatReport(report)}\n`)
  return 0
}
