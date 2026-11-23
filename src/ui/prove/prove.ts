import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import type { UiConfig, UiSwitch, UiVariant } from '../../core/config-ui'
import { toSlash } from '../../core/paths'
import { workingTree } from '../../pre-mr/pre-mr'
import { EXIT_FINDINGS, projectRootOf, requireUi, UsageError, type UiContext } from '../command'
import { DEVIATIONS_FILE, declareReference, EVIDENCE_PAGE, uiBranchDir } from '../dir'
import { buildMatrix, type Combo } from '../matrix'
import { recordPassed } from '../proof'
import { renderPage } from './page'
import { decodePng, diffImages } from './png'
import { defaultFetch, describeReference, expandImagePath, fetchFigmaImage, parseReference, readImage, type ReferenceSpec } from './reference'
import { auditErrors, failuresOf, type AuditFinding, type AuditOutcome, type ComboResult, type ProveResult, type SkippedCombo, type StateResult } from './result'
import { failureOf, findAgentViewConfig, hasSceneHook, spawnAgentView, type AgentViewRunner } from './runner'

export const PROVE_USAGE = `usage: jig ui prove [--reference figma:<Figma URL with node-id>|image:<PNG path>] [--states <use case>[,<use case>...]] [--target <name>] [--root <test id or selector>] [--no-scene] [--exact] [--launched <theme or locale>[,...]] [--json]

Drives every combination of \`jig ui matrix\` in the running app through agent-view: emulates its width, height, pointer and color scheme, switches the theme and locale, replays each state (a use case; none: the current screen), audits the layout (and the scene when agent-view.config.json has webgl.engine app-hook), screenshots it, and compares it with the reference. Writes .jig/ui/<branch>/index.html.
  --reference  figma:<url> (the frame is fetched as a PNG with JIG_FIGMA_API_KEY, else FIGMA_API_KEY) or image:<path>; a path may hold {target} {width} {theme} {locale} {state}. A single reference is compared with the combinations as wide as it is, in the first theme
  --states     agent-view use cases to replay before each audit
  --target     only this target's combinations (the proof is recorded when every combination has a result for the current working tree)
  --root       audit only this test id or CSS selector and what it holds
  --no-scene   skip the scene audit
  --exact      a nonzero pixel diff against the reference fails (a reference that is an existing implementation)
  --launched   theme or locale names the app was launched with: a variant with a launch switch can only be proven when named here

Exit 1 while an audit error, a failed state or (with --exact) a pixel diff stands, 2 when agent-view is not configured or cannot reach the app.`

const EXIT_ENVIRONMENT = 2
const PIXEL_TOLERANCE = 12
const RESULT_FILE = 'result.json'
const REFERENCE_DIR = 'ref'

interface ProveOptions {
  reference?: ReferenceSpec
  states: string[]
  target?: string
  root?: string
  scene: boolean
  exact: boolean
  launched: string[]
  json: boolean
}

interface Loaded {
  spec: ReferenceSpec
  image?: Buffer
  note?: string
  copy?: string
}

const slug = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'screen'

const comboId = (combo: Combo): string => slug(`${combo.target}-${combo.width}-${combo.theme}${combo.locale === undefined ? '' : `-${combo.locale}`}`)

const comboLabel = (combo: Combo): string =>
  `${combo.target} ${combo.width}${combo.height === undefined ? '' : `x${combo.height}`} ${combo.input ?? ''} theme ${combo.theme}${combo.locale === undefined ? '' : ` locale ${combo.locale}`}`.replace(/\s+/g, ' ')

const splitList = (values: string[] | undefined): string[] => (values ?? []).flatMap((value) => value.split(',')).map((item) => item.trim()).filter(Boolean)

const parseOptions = (args: string[]): ProveOptions => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      reference: { type: 'string' },
      states: { type: 'string', multiple: true },
      target: { type: 'string' },
      root: { type: 'string' },
      'no-scene': { type: 'boolean' },
      exact: { type: 'boolean' },
      launched: { type: 'string', multiple: true },
      json: { type: 'boolean' },
    },
  })
  if (positionals.length > 0) throw new UsageError(PROVE_USAGE)
  let reference: ReferenceSpec | undefined
  if (values.reference !== undefined) {
    try {
      reference = parseReference(values.reference)
    } catch (error) {
      throw new UsageError(`${error instanceof Error ? error.message : String(error)}\n\n${PROVE_USAGE}`)
    }
  }
  return {
    ...(reference === undefined ? {} : { reference }),
    states: splitList(values.states),
    ...(values.target === undefined ? {} : { target: values.target }),
    ...(values.root === undefined ? {} : { root: values.root }),
    scene: values['no-scene'] !== true,
    exact: values.exact === true,
    launched: splitList(values.launched),
    json: values.json === true,
  }
}

const needsRelaunch = (switchTo: UiSwitch | undefined, name: string, launched: readonly string[]): string | undefined =>
  switchTo?.launch === undefined || launched.includes(name) ? undefined : `${name} switches by launch (${switchTo.launch}): relaunch the app with it and rerun with --launched ${name}`

const readJson = (text: string): unknown => {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return undefined
  }
}

interface RawAudit {
  scanned?: number
  counts?: { error?: number; warn?: number }
  findings?: AuditFinding[]
}

const auditOutcome = (kind: AuditOutcome['kind'], raw: RawAudit, shot: string | undefined): AuditOutcome => {
  const findings = raw.findings ?? []
  return {
    kind,
    errors: raw.counts?.error ?? findings.filter((finding) => finding.severity === 'error').length,
    warnings: raw.counts?.warn ?? findings.filter((finding) => finding.severity === 'warn').length,
    ...(raw.scanned === undefined ? {} : { scanned: raw.scanned }),
    findings,
    ...(shot === undefined || findings.length === 0 ? {} : { shot }),
  }
}

const loadReference = async (spec: ReferenceSpec | undefined, ctx: UiContext, root: string): Promise<Loaded | undefined> => {
  if (spec === undefined) return undefined
  if (spec.kind === 'image') {
    const image = spec.path.includes('{') ? undefined : readImage(ctx.cwd, spec.path)
    if (!spec.path.includes('{') && image === undefined) throw new UsageError(`--reference image:${spec.path}: no such file`)
    return { spec, ...(image === undefined ? {} : { image }) }
  }
  try {
    const file = await fetchFigmaImage(root, spec.url, ctx.fetch ?? defaultFetch, ctx.env)
    return { spec, image: readFileSync(file) }
  } catch (error) {
    return { spec, note: `Figma frame not fetched, so no pixel comparison: ${error instanceof Error ? error.message : String(error)}` }
  }
}

interface RunState {
  ctx: UiContext
  runner: AgentViewRunner
  root: string
  dir: string
  options: ProveOptions
  scene: boolean
  firstTheme: string
  reference?: Loaded
  tree: string
}

const pathIn = (state: RunState, ...parts: string[]): { file: string; shown: string } => {
  const file = join(state.dir, ...parts)
  mkdirSync(dirname(file), { recursive: true })
  return { file, shown: toSlash(relative(state.dir, file)) }
}

const referenceFor = (state: RunState, combo: Combo, stateName: string): { image?: Buffer; key: string; note?: string } | undefined => {
  const loaded = state.reference
  if (loaded === undefined) return undefined
  if (loaded.note !== undefined) return { key: '', note: loaded.note }
  if (loaded.spec.kind === 'image' && loaded.spec.path.includes('{')) {
    const path = expandImagePath(loaded.spec.path, { target: combo.target, width: String(combo.width), theme: combo.theme, locale: combo.locale ?? '', state: stateName })
    const image = readImage(state.ctx.cwd, path)
    return image === undefined ? { key: '', note: `no reference image at ${path}` } : { image, key: slug(path) }
  }
  if (loaded.image === undefined) return undefined
  const decoded = decodePng(loaded.image)
  if (decoded.width !== combo.width) return { key: '', note: `reference is ${decoded.width} px wide, this combination ${combo.width} px: not compared` }
  if (combo.theme !== state.firstTheme) return { key: '', note: `the single reference stands for the first theme (${state.firstTheme}): not compared in ${combo.theme}` }
  return { image: loaded.image, key: 'reference' }
}

const compare = (state: RunState, combo: Combo, stateName: string, shotFile: string): Pick<StateResult, 'diff' | 'referenceNote'> => {
  const found = referenceFor(state, combo, stateName)
  if (found === undefined) return {}
  if (found.image === undefined) return found.note === undefined ? {} : { referenceNote: found.note }
  try {
    const diff = diffImages(decodePng(found.image), decodePng(readFileSync(shotFile)), state.options.exact ? 0 : PIXEL_TOLERANCE)
    const copy = pathIn(state, REFERENCE_DIR, `${found.key}.png`)
    writeFileSync(copy.file, found.image)
    const map = pathIn(state, comboId(combo), `${slug(stateName)}-diff.png`)
    writeFileSync(map.file, diff.map)
    return { diff: { reference: copy.shown, map: map.shown, differing: diff.differing, total: diff.total, ratio: diff.ratio, sizeMismatch: diff.sizeMismatch } }
  } catch (error) {
    return { referenceNote: `reference not compared: ${error instanceof Error ? error.message : String(error)}` }
  }
}

const runAudit = (state: RunState, kind: 'dom' | 'scene', combo: Combo, stateName: string): AuditOutcome | { abort: string } => {
  const shot = pathIn(state, comboId(combo), `${slug(stateName)}-${kind === 'dom' ? 'audit' : 'scene'}.png`)
  const args = ['audit', ...(kind === 'scene' ? ['--scene'] : []), '--json', '--shot', shot.file, ...(kind === 'dom' && state.options.root !== undefined ? ['--root', state.options.root] : [])]
  const result = state.runner(args, state.root)
  const raw = readJson(result.stdout) as RawAudit | undefined
  if ((result.code === 0 || result.code === 1) && raw !== undefined) return auditOutcome(kind, raw, shot.shown)
  const why = `${kind === 'dom' ? 'layout' : 'scene'} audit could not run: ${failureOf(result)}`
  return kind === 'dom' ? { abort: why } : { kind, errors: 0, warnings: 0, findings: [], note: why }
}

const runState = (state: RunState, combo: Combo, stateName: string, replay: boolean): StateResult | { abort: string } => {
  const id = comboId(combo)
  if (replay) {
    const replayed = state.runner(['act', 'replay', stateName], state.root)
    if (replayed.code !== 0) return { state: stateName, failure: `act replay ${stateName} exited ${replayed.code}: ${failureOf(replayed)}`, audits: [] }
  }
  const audits: AuditOutcome[] = []
  const dom = runAudit(state, 'dom', combo, stateName)
  if ('abort' in dom) return dom
  audits.push(dom)
  if (state.scene) {
    const scene = runAudit(state, 'scene', combo, stateName)
    if (!('abort' in scene)) audits.push(scene)
  }
  const shot = pathIn(state, id, `${slug(stateName)}.png`)
  const taken = state.runner(['screenshot', '--out', shot.file], state.root)
  if (taken.code !== 0) return { state: stateName, failure: `screenshot failed: ${failureOf(taken)}`, audits }
  return { state: stateName, shot: shot.shown, audits, ...compare(state, combo, stateName, shot.file) }
}

const emulateArgs = (combo: Combo): string[] => [
  'emulate',
  '--reset',
  '--width',
  String(combo.width),
  ...(combo.height === undefined ? [] : ['--height', String(combo.height)]),
  ...(combo.input === undefined ? [] : ['--pointer', combo.input]),
  ...(combo.themeSwitch?.media === undefined ? [] : ['--color-scheme', combo.themeSwitch.media]),
]

const runCombo = (state: RunState, combo: Combo): ComboResult | { abort: string } => {
  const emulated = state.runner(emulateArgs(combo), state.root)
  if (emulated.code !== 0) return { abort: `agent-view emulate failed: ${failureOf(emulated)}` }
  const result: ComboResult = { id: comboId(combo), combo, tree: state.tree, states: [] }
  for (const switchTo of [combo.themeSwitch, combo.localeSwitch]) {
    if (switchTo?.act === undefined) continue
    const switched = state.runner(['act', 'replay', switchTo.act], state.root)
    if (switched.code !== 0) return { ...result, failure: `switch ${switchTo.act} exited ${switched.code}: ${failureOf(switched)}` }
  }
  const names = state.options.states.length > 0 ? state.options.states : ['screen']
  for (const name of names) {
    const outcome = runState(state, combo, name, state.options.states.length > 0)
    if ('abort' in outcome) return outcome
    result.states.push(outcome)
  }
  return result
}

const variantOf = (list: readonly UiVariant[] | undefined, name: string | undefined): UiVariant | undefined => list?.find((variant) => variant.name === name)

const skipReason = (ui: UiConfig, combo: Combo, launched: readonly string[]): string | undefined => {
  const theme = needsRelaunch(variantOf(ui.themes, combo.theme)?.switch, combo.theme, launched)
  return theme ?? needsRelaunch(variantOf(ui.locales?.list, combo.locale)?.switch, combo.locale ?? '', launched)
}

const readPrevious = (file: string): ProveResult | undefined => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ProveResult
  } catch {
    return undefined
  }
}

const describeCombo = (result: ComboResult): string[] => {
  const lines = [`${comboLabel(result.combo)}`]
  for (const state of result.states) {
    const counts = state.audits.map((audit) => `${audit.kind} ${audit.errors} errors ${audit.warnings} warnings`).join(', ')
    const diff = state.diff === undefined ? '' : `, ${(state.diff.ratio * 100).toFixed(2)} % of pixels differ from the reference`
    lines.push(`  ${state.state}: ${state.failure ?? counts}${diff}${state.shot === undefined ? '' : `  ${state.shot}`}`)
    for (const audit of state.audits) {
      for (const finding of audit.findings.filter((entry) => entry.severity === 'error')) {
        lines.push(`    error ${finding.rule} ${finding.target.testid === undefined ? finding.target.selector : `testid=${finding.target.testid}`}: ${finding.detail}`)
      }
      if (audit.note !== undefined) lines.push(`    ${audit.note}`)
    }
    if (state.referenceNote !== undefined) lines.push(`    ${state.referenceNote}`)
  }
  for (const failure of result.failure === undefined ? [] : [result.failure]) lines.push(`  ${failure}`)
  return lines
}

export const prove = async (args: string[], ctx: UiContext): Promise<number> => {
  const options = parseOptions(args)
  const root = projectRootOf(ctx.cwd)
  const ui = requireUi(root)
  const full = buildMatrix(ui)
  const known = new Set([...full.combos.map((combo) => combo.target), ...full.manual.map((target) => target.name)])
  if (options.target !== undefined && !known.has(options.target)) throw new UsageError(`--target ${options.target}: no such target, expected ${[...known].join(', ')}`)
  const combos = full.combos.filter((combo) => options.target === undefined || combo.target === options.target)
  const manual = full.manual.filter((target) => options.target === undefined || target.name === options.target)
  if (combos.length === 0) throw new UsageError(`no combination to prove${options.target === undefined ? '' : ` for target ${options.target}`}: the target is proven by hand`)

  const configFile = findAgentViewConfig(root)
  if (configFile === undefined) {
    ctx.io.err('jig: agent-view is not configured: no agent-view.config.json in the project or above it (agent-view init)\n')
    return EXIT_ENVIRONMENT
  }
  const runner = ctx.agentView ?? spawnAgentView(root)
  const probe = runner(['emulate', '--json'], root)
  if (probe.code !== 0) {
    ctx.io.err(`jig: agent-view cannot reach the app: ${failureOf(probe)}\n`)
    return EXIT_ENVIRONMENT
  }

  if (options.reference?.kind === 'figma') declareReference(root, `figma:${options.reference.url}`)
  const reference = await loadReference(options.reference, ctx, root)
  const dir = uiBranchDir(root)
  mkdirSync(dir, { recursive: true })
  const tree = (() => {
    try {
      return workingTree(root)
    } catch {
      return ''
    }
  })()
  const state: RunState = {
    ctx,
    runner,
    root,
    dir,
    options,
    scene: options.scene && hasSceneHook(configFile),
    firstTheme: ui.themes[0]?.name ?? '',
    ...(reference === undefined ? {} : { reference }),
    tree,
  }

  const ran: ComboResult[] = []
  const skipped: SkippedCombo[] = []
  const notes: string[] = []
  if (reference?.note !== undefined) notes.push(reference.note)
  let aborted: string | undefined
  try {
    for (const combo of combos) {
      const why = skipReason(ui, combo, options.launched)
      if (why !== undefined) {
        skipped.push({ id: comboId(combo), combo, why })
        ctx.io.out(`skipped ${comboLabel(combo)}: ${why}\n`)
        continue
      }
      const outcome = runCombo(state, combo)
      if ('abort' in outcome) {
        aborted = outcome.abort
        break
      }
      ran.push(outcome)
      ctx.io.out(`${describeCombo(outcome).join('\n')}\n`)
    }
  } finally {
    const reset = runner(['emulate', '--reset'], root)
    if (reset.code !== 0) notes.push(`emulation was not reset: ${failureOf(reset)}`)
  }
  if (aborted !== undefined) {
    ctx.io.err(`jig: ${aborted}\n`)
    return EXIT_ENVIRONMENT
  }

  const resultFile = join(dir, RESULT_FILE)
  const previous = readPrevious(resultFile)
  const kept = (previous?.combos ?? []).filter((old) => old.tree === tree && tree !== '' && !ran.some((fresh) => fresh.id === old.id))
  const merged = [...kept, ...ran]
  const proven: ProveResult = {
    branch: dir.replace(/\\/g, '/').split('/').pop() ?? '',
    generatedAt: new Date().toISOString(),
    tree,
    ...(options.reference === undefined ? {} : { reference: describeReference(options.reference) }),
    ...(options.root === undefined ? {} : { root: options.root }),
    combos: merged,
    skipped,
    manual: full.manual,
    notes,
  }
  writeFileSync(resultFile, `${JSON.stringify(proven, null, 2)}\n`)
  const deviationsFile = join(dir, DEVIATIONS_FILE)
  writeFileSync(join(dir, EVIDENCE_PAGE), renderPage(proven, existsSync(deviationsFile) ? readFileSync(deviationsFile, 'utf8') : undefined))

  const errors = merged.reduce((sum, combo) => sum + auditErrors(combo), 0)
  const failures = merged.flatMap(failuresOf)
  const pixelFailures = options.exact ? ran.flatMap((combo) => combo.states).filter((entry) => (entry.diff?.differing ?? 0) > 0).length : 0
  const covered = full.combos.every((combo) => merged.some((entry) => entry.id === comboId(combo)))
  const summary = `ui prove: ${ran.length} combinations driven, ${errors} audit errors${failures.length > 0 ? `, ${failures.length} failed states` : ''}${pixelFailures > 0 ? `, ${pixelFailures} states differ from the reference` : ''}${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}`
  if (options.json) ctx.io.out(`${JSON.stringify(proven, null, 2)}\n`)
  ctx.io.out(`${summary}\nevidence: ${join(dir, EVIDENCE_PAGE)}\n`)
  if (manual.length > 0) ctx.io.out(`check by hand: ${manual.map((target) => target.name).join(', ')}\n`)
  if (errors > 0 || failures.length > 0 || pixelFailures > 0) return EXIT_FINDINGS
  if (!covered) {
    const missing = full.combos.filter((combo) => !merged.some((entry) => entry.id === comboId(combo))).map(comboLabel)
    ctx.io.err(`jig: ui-matrix proof not recorded, no result for the current working tree for: ${missing.join('; ')}\n`)
    return 0
  }
  recordPassed(root, 'ui-matrix', `jig ui prove: ${merged.length} combinations, 0 audit errors`, ctx.io)
  return 0
}
