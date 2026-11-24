import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import type { UiConfig, UiDriver, UiSwitch, UiVariant } from '../../core/config-ui'
import { toSlash } from '../../core/paths'
import { workingTree } from '../../pre-mr/pre-mr'
import { resolveUiBase } from '../base'
import { EXIT_FINDINGS, projectRootOf, requireReferences, requireUi, UsageError, type UiContext } from '../command'
import { DEVIATIONS_FILE, EVIDENCE_PAGE, uiBranchDir } from '../dir'
import { buildMatrix, type Combo } from '../matrix'
import { recordPassed } from '../proof'
import { referencePath, type ReferenceEntry } from '../references'
import { changedFiles } from '../reuse'
import { failureOf, fillTemplate, shellRunner, type CommandRunner } from '../run'
import { normText } from '../tree'
import { AUDIT_FILE, COMBO_RESULT_FILE, DEFAULT_STATE, parseAudit, parseComboResult, SHOT_FILE, type StateFiles } from './formats'
import { renderPage } from './page'
import { decodePng, diffImages, pngSize } from './png'
import { auditErrors, failuresOf, type ComboResult, type ProveResult, type ReferenceDiff, type SkippedCombo, type StateResult } from './result'

export const PROVE_USAGE = `usage: jig ui prove [--collect] [--states <use case>[,<use case>...]] [--target <name>] [--exact] [--launched <theme or locale>[,...]] [--json]

Proves every combination of \`jig ui matrix\` on the running app and writes .jig/ui/<branch>/index.html. Two ways to get the results:
  ui.driver   command templates in .jig/config.local.jsonc: prepare (optional), capture, reset (optional), with {width} {height} {pointer} {theme} {locale} {state} {target} {out}.
              jig runs them per combination and state; capture writes {out}/shot.png and {out}/audit.json (schema/ui-audit.schema.json)
  --collect   the results were produced by the agent itself under .jig/ui/<branch>/<target>-<width>-<theme>[-<locale>]/: shot.png, audit.json and result.json
              (schema/ui-result.schema.json); jig checks that every combination is there, the shot is as wide as the combination, and the files are newer than the last edit
Each reference with an image (jig ui reference attach <n> --image) is compared with the shots of the combinations it covers, or, with no covers, of the first theme at its width.
  --states     states (use cases) to capture in each combination; the names are passed as {state}, or must be in each result.json with --collect
  --target     only this target's combinations (the proof is recorded when every combination has a result for the current working tree)
  --exact      a nonzero pixel diff against a reference fails (a reference that is an existing implementation)
  --launched   theme or locale names the app was launched with: a variant with a launch switch can only be proven when named here (driver only)

Exit 1 while an audit error, a failed state, a collect problem or (with --exact) a pixel diff stands, 2 when neither ui.driver nor --collect is available or the driver cannot reach the app.`

const EXIT_ENVIRONMENT = 2
const PIXEL_TOLERANCE = 12
const RESULT_FILE = 'result.json'

interface ProveOptions {
  collect: boolean
  states: string[]
  target?: string
  exact: boolean
  launched: string[]
  json: boolean
}

interface RefImage {
  entry: ReferenceEntry
  image: Buffer
  width: number
  rel: string
}

const slug = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'screen'

export const comboId = (combo: Combo): string => slug(`${combo.target}-${combo.width}-${combo.theme}${combo.locale === undefined ? '' : `-${combo.locale}`}`)

const comboLabel = (combo: Combo): string =>
  `${combo.target} ${combo.width}${combo.height === undefined ? '' : `x${combo.height}`} ${combo.input ?? ''} theme ${combo.theme}${combo.locale === undefined ? '' : ` locale ${combo.locale}`}`.replace(/\s+/g, ' ')

const splitList = (values: string[] | undefined): string[] => (values ?? []).flatMap((value) => value.split(',')).map((item) => item.trim()).filter(Boolean)

const parseOptions = (args: string[]): ProveOptions => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      collect: { type: 'boolean' },
      states: { type: 'string', multiple: true },
      target: { type: 'string' },
      exact: { type: 'boolean' },
      launched: { type: 'string', multiple: true },
      json: { type: 'boolean' },
    },
  })
  if (positionals.length > 0) throw new UsageError(PROVE_USAGE)
  return {
    collect: values.collect === true,
    states: splitList(values.states),
    ...(values.target === undefined ? {} : { target: values.target }),
    exact: values.exact === true,
    launched: splitList(values.launched),
    json: values.json === true,
  }
}

const needsRelaunch = (switchTo: UiSwitch | undefined, name: string, launched: readonly string[]): string | undefined =>
  switchTo?.launch === undefined || launched.includes(name) ? undefined : `${name} switches by launch (${switchTo.launch}): relaunch the app with it and rerun with --launched ${name}`

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

interface RunState {
  dir: string
  ui: UiConfig
  options: ProveOptions
  references: RefImage[]
  tree: string
}

const loadRefImages = (root: string, entries: readonly ReferenceEntry[], notes: string[]): RefImage[] =>
  entries.flatMap((entry) => {
    if (entry.image === undefined) return []
    try {
      const image = readFileSync(referencePath(root, entry.image))
      return [{ entry, image, width: pngSize(image).width, rel: entry.image }]
    } catch (error) {
      notes.push(`reference ${entry.n} image not read: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  })

const mentions = (covers: string, name: string): boolean => normText(covers).includes(normText(name))

const covered = (state: RunState, entry: ReferenceEntry, combo: Combo, stateName: string): boolean => {
  const firstTheme = state.ui.themes[0]?.name ?? ''
  const covers = entry.covers
  if (covers === undefined) return combo.theme === firstTheme
  const stateNames = state.options.states.length > 0 ? state.options.states : [DEFAULT_STATE]
  const named = (names: readonly string[]): string[] => names.filter((name) => mentions(covers, name))
  const states = named(stateNames)
  const targets = named(state.ui.targets.map((target) => target.name))
  const themes = named(state.ui.themes.map((theme) => theme.name))
  if (states.length > 0 && !states.includes(stateName)) return false
  if (targets.length > 0 && !targets.includes(combo.target)) return false
  return themes.length > 0 ? themes.includes(combo.theme) : combo.theme === firstTheme
}

const compare = (state: RunState, combo: Combo, stateName: string, shotFile: string, scaleFactor: number): Pick<StateResult, 'diffs' | 'referenceNotes'> => {
  const diffs: ReferenceDiff[] = []
  const referenceNotes: string[] = []
  for (const ref of state.references) {
    if (!covered(state, ref.entry, combo, stateName)) continue
    if (ref.width !== Math.round(combo.width * scaleFactor)) {
      referenceNotes.push(`reference ${ref.entry.n} is ${ref.width} px wide, this combination ${combo.width} px: not compared`)
      continue
    }
    try {
      const diff = diffImages(decodePng(ref.image), decodePng(readFileSync(shotFile)), state.options.exact ? 0 : PIXEL_TOLERANCE)
      const mapFile = join(state.dir, comboId(combo), `${slug(stateName)}-ref${ref.entry.n}-diff.png`)
      mkdirSync(dirname(mapFile), { recursive: true })
      writeFileSync(mapFile, diff.map)
      diffs.push({ n: ref.entry.n, reference: ref.rel, map: toSlash(relative(state.dir, mapFile)), differing: diff.differing, total: diff.total, ratio: diff.ratio, sizeMismatch: diff.sizeMismatch })
    } catch (error) {
      referenceNotes.push(`reference ${ref.entry.n} not compared: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { diffs, referenceNotes }
}

type Loaded = { state: StateResult } | { problem: string }

const loadState = (state: RunState, combo: Combo, comboDir: string, files: StateFiles, scaleFactor: number): Loaded => {
  const shown = (file: string): string => toSlash(relative(state.dir, join(comboDir, file)))
  if (files.failure !== undefined) return { state: { state: files.name, failure: files.failure, audits: [], diffs: [], referenceNotes: [] } }
  const shot = join(comboDir, files.shot ?? SHOT_FILE)
  const auditFile = join(comboDir, files.audit ?? AUDIT_FILE)
  if (!existsSync(shot)) return { problem: `${shown(files.shot ?? SHOT_FILE)}: no such file` }
  if (!existsSync(auditFile)) return { problem: `${shown(files.audit ?? AUDIT_FILE)}: no such file` }
  let width: number
  try {
    width = pngSize(readFileSync(shot)).width
  } catch (error) {
    return { problem: `${shown(files.shot ?? SHOT_FILE)}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const expected = Math.round(combo.width * scaleFactor)
  if (width !== expected) return { problem: `${shown(files.shot ?? SHOT_FILE)} is ${width} px wide, the combination ${combo.width} px${scaleFactor === 1 ? '' : ` at device scale ${scaleFactor}`}: capture it at the combination's width` }
  const parsed = parseAudit(readFileSync(auditFile, 'utf8'))
  if (parsed.audits === undefined) return { problem: `${shown(files.audit ?? AUDIT_FILE)} is not a jig audit (schema/ui-audit.schema.json): ${parsed.errors.join('; ')}` }
  const audits = parsed.audits.map((audit) => (audit.shot === undefined ? audit : { ...audit, shot: toSlash(relative(state.dir, join(dirname(auditFile), audit.shot))) }))
  return { state: { state: files.name, shot: shown(files.shot ?? SHOT_FILE), audits, ...compare(state, combo, files.name, shot, scaleFactor) } }
}

const latestEdit = (root: string): { file: string; at: number } | undefined => {
  const base = resolveUiBase(root, undefined, 'ui prove')
  let latest: { file: string; at: number } | undefined
  for (const file of changedFiles(root, base.tracked).filter((path) => !path.startsWith('.jig/'))) {
    const at = statSync(join(root, file)).mtimeMs
    if (latest === undefined || at > latest.at) latest = { file, at }
  }
  return latest
}

const collectCombo = (state: RunState, combo: Combo, edit: { file: string; at: number } | undefined): ComboResult | { problems: string[] } => {
  const id = comboId(combo)
  const comboDir = join(state.dir, id)
  const resultFile = join(comboDir, COMBO_RESULT_FILE)
  if (!existsSync(resultFile)) return { problems: [`${id}/${COMBO_RESULT_FILE}: no result for ${comboLabel(combo)}`] }
  const parsed = parseComboResult(readFileSync(resultFile, 'utf8'))
  if (parsed.result === undefined) return { problems: [`${id}/${COMBO_RESULT_FILE} is not a jig result (schema/ui-result.schema.json): ${parsed.errors.join('; ')}`] }
  const { scaleFactor, failure, states: files } = parsed.result
  const problems: string[] = []
  for (const name of state.options.states) {
    if (!files.some((file) => file.name === name)) problems.push(`${id}/${COMBO_RESULT_FILE}: no state ${name}`)
  }
  const states: StateResult[] = []
  for (const file of files) {
    for (const name of [file.shot, file.audit]) {
      if (name === undefined || edit === undefined || !existsSync(join(comboDir, name))) continue
      if (statSync(join(comboDir, name)).mtimeMs < edit.at) problems.push(`${id}/${name} was written before the last edit of ${edit.file}: capture ${comboLabel(combo)} again`)
    }
    const loaded = loadState(state, combo, comboDir, file, scaleFactor)
    if ('problem' in loaded) problems.push(loaded.problem)
    else states.push(loaded.state)
  }
  if (problems.length > 0) return { problems }
  return { id, combo, tree: state.tree, scaleFactor, ...(failure === undefined ? {} : { failure }), states }
}

const quotedValues = (combo: Combo, stateName: string, out: string): Record<string, string | number | undefined> => ({
  width: combo.width,
  height: combo.height,
  pointer: combo.input,
  theme: combo.theme,
  locale: combo.locale,
  state: stateName,
  out,
  target: combo.target,
})

const driveCombo = (state: RunState, combo: Combo, driver: UiDriver, run: CommandRunner, root: string): ComboResult | { abort: string } => {
  const id = comboId(combo)
  const comboDir = join(state.dir, id)
  const names = state.options.states.length > 0 ? state.options.states : [DEFAULT_STATE]
  const result: ComboResult = { id, combo, tree: state.tree, states: [] }
  const files: StateFiles[] = []
  for (const name of names) {
    const out = state.options.states.length > 0 ? join(comboDir, slug(name)) : comboDir
    mkdirSync(out, { recursive: true })
    rmSync(join(out, SHOT_FILE), { force: true })
    rmSync(join(out, AUDIT_FILE), { force: true })
    const values = quotedValues(combo, name, out)
    const toCombo = (file: string): string => toSlash(relative(comboDir, join(out, file)))
    if (driver.prepare !== undefined) {
      const prepared = run(fillTemplate(driver.prepare, values), root)
      if (prepared.code !== 0) {
        const failure = `prepare exited ${prepared.code ?? 'without a code'}: ${failureOf(prepared)}`
        files.push({ name, failure })
        result.states.push({ state: name, failure, audits: [], diffs: [], referenceNotes: [] })
        continue
      }
    }
    const captured = run(fillTemplate(driver.capture, values), root)
    if (captured.code !== 0) return { abort: `capture exited ${captured.code ?? 'without a code'}: ${failureOf(captured)}` }
    const own: StateFiles = { name, shot: toCombo(SHOT_FILE), audit: toCombo(AUDIT_FILE) }
    const loaded = loadState(state, combo, comboDir, own, 1)
    if ('problem' in loaded) {
      files.push({ name, failure: loaded.problem })
      result.states.push({ state: name, failure: loaded.problem, audits: [], diffs: [], referenceNotes: [] })
    } else {
      files.push(own)
      result.states.push(loaded.state)
    }
  }
  writeFileSync(join(comboDir, COMBO_RESULT_FILE), `${JSON.stringify({ version: 1, states: files }, null, 2)}\n`)
  return result
}

const describeCombo = (result: ComboResult): string[] => {
  const lines = [`${comboLabel(result.combo)}`]
  for (const state of result.states) {
    const counts = state.audits.map((audit) => `${audit.kind} ${audit.errors} errors ${audit.warnings} warnings`).join(', ')
    const diffs = state.diffs.map((diff) => `, ${(diff.ratio * 100).toFixed(2)} % of pixels differ from reference ${diff.n}`).join('')
    lines.push(`  ${state.state}: ${state.failure ?? counts}${diffs}${state.shot === undefined ? '' : `  ${state.shot}`}`)
    for (const audit of state.audits) {
      for (const finding of audit.findings.filter((entry) => entry.severity === 'error')) {
        lines.push(`    error ${finding.rule} ${finding.target.testid === undefined ? finding.target.selector : `testid=${finding.target.testid}`}: ${finding.detail}`)
      }
      if (audit.note !== undefined) lines.push(`    ${audit.note}`)
    }
    for (const note of state.referenceNotes) lines.push(`    ${note}`)
  }
  for (const failure of result.failure === undefined ? [] : [result.failure]) lines.push(`  ${failure}`)
  return lines
}

const NO_EXECUTOR = 'jig: ui prove has nothing to drive the app with. Either set ui.driver in .jig/config.local.jsonc (prepare, capture, reset command templates; jig then runs `jig ui prove` itself), or capture every combination yourself with the app control tool of your environment into .jig/ui/<branch>/<target>-<width>-<theme>[-<locale>]/ (shot.png, audit.json, result.json) and run `jig ui prove --collect`.\n'

export const prove = async (args: string[], ctx: UiContext): Promise<number> => {
  const options = parseOptions(args)
  const root = projectRootOf(ctx.cwd)
  const ui = requireUi(root)
  const references = requireReferences(root)
  const full = buildMatrix(ui)
  const known = new Set([...full.combos.map((combo) => combo.target), ...full.manual.map((target) => target.name)])
  if (options.target !== undefined && !known.has(options.target)) throw new UsageError(`--target ${options.target}: no such target, expected ${[...known].join(', ')}`)
  const combos = full.combos.filter((combo) => options.target === undefined || combo.target === options.target)
  const manual = full.manual.filter((target) => options.target === undefined || target.name === options.target)
  if (combos.length === 0) throw new UsageError(`no combination to prove${options.target === undefined ? '' : ` for target ${options.target}`}: the target is proven by hand`)
  const driver = options.collect ? undefined : ui.driver
  if (!options.collect && driver === undefined) {
    ctx.io.err(NO_EXECUTOR)
    return EXIT_ENVIRONMENT
  }
  const run = ctx.run ?? shellRunner

  const dir = uiBranchDir(root)
  mkdirSync(dir, { recursive: true })
  const tree = (() => {
    try {
      return workingTree(root)
    } catch {
      return ''
    }
  })()
  const notes: string[] = []
  const state: RunState = { dir, ui, options, references: loadRefImages(root, references.entries, notes), tree }

  const ran: ComboResult[] = []
  const skipped: SkippedCombo[] = []
  const problems: string[] = []
  let aborted: string | undefined
  const edit = options.collect ? latestEdit(root) : undefined
  for (const combo of combos) {
    const why = options.collect ? undefined : skipReason(ui, combo, options.launched)
    if (why !== undefined) {
      skipped.push({ id: comboId(combo), combo, why })
      ctx.io.out(`skipped ${comboLabel(combo)}: ${why}\n`)
      continue
    }
    if (driver === undefined) {
      const collected = collectCombo(state, combo, edit)
      if ('problems' in collected) {
        problems.push(...collected.problems)
        continue
      }
      ran.push(collected)
      ctx.io.out(`${describeCombo(collected).join('\n')}\n`)
      continue
    }
    let outcome: ComboResult | { abort: string }
    try {
      outcome = driveCombo(state, combo, driver, run, root)
    } finally {
      if (driver.reset !== undefined) {
        const reset = run(fillTemplate(driver.reset, quotedValues(combo, '', join(dir, comboId(combo)))), root)
        if (reset.code !== 0) notes.push(`reset after ${comboLabel(combo)} failed: ${failureOf(reset)}`)
      }
    }
    if ('abort' in outcome) {
      aborted = `${comboLabel(combo)}: ${outcome.abort}`
      break
    }
    ran.push(outcome)
    ctx.io.out(`${describeCombo(outcome).join('\n')}\n`)
  }
  if (aborted !== undefined) notes.push(`run stopped: ${aborted}`)
  notes.push(...problems.map((problem) => `collect: ${problem}`))

  const resultFile = join(dir, RESULT_FILE)
  const previous = readPrevious(resultFile)
  const kept = (previous?.combos ?? []).filter((old) => old.tree === tree && tree !== '' && !ran.some((fresh) => fresh.id === old.id))
  const merged = [...kept, ...ran]
  const proven: ProveResult = {
    branch: dir.replace(/\\/g, '/').split('/').pop() ?? '',
    generatedAt: new Date().toISOString(),
    tree,
    ...(references.entries.length === 0 ? {} : { reference: references.entries.map((entry) => `${entry.n} ${entry.source}`).join('; ') }),
    combos: merged,
    skipped,
    manual: full.manual,
    notes,
  }
  writeFileSync(resultFile, `${JSON.stringify(proven, null, 2)}\n`)
  const deviationsFile = join(dir, DEVIATIONS_FILE)
  writeFileSync(join(dir, EVIDENCE_PAGE), renderPage(proven, existsSync(deviationsFile) ? readFileSync(deviationsFile, 'utf8') : undefined))

  if (aborted !== undefined) {
    ctx.io.err(`jig: ${aborted}\nevidence of the ${ran.length} combinations done: ${join(dir, EVIDENCE_PAGE)}\n`)
    return EXIT_ENVIRONMENT
  }
  if (problems.length > 0) {
    ctx.io.err(`jig: ui prove --collect found ${problems.length} problems:\n${problems.map((problem) => `  ${problem}`).join('\n')}\nevidence of the ${ran.length} combinations read: ${join(dir, EVIDENCE_PAGE)}\n`)
    return EXIT_FINDINGS
  }

  const errors = merged.reduce((sum, combo) => sum + auditErrors(combo), 0)
  const failures = merged.flatMap(failuresOf)
  const pixelFailures = options.exact ? ran.flatMap((combo) => combo.states).filter((entry) => entry.diffs.some((diff) => diff.differing > 0)).length : 0
  const isCovered = full.combos.every((combo) => merged.some((entry) => entry.id === comboId(combo)))
  const summary = `ui prove: ${ran.length} combinations ${options.collect ? 'read' : 'driven'}, ${errors} audit errors${failures.length > 0 ? `, ${failures.length} failed states` : ''}${pixelFailures > 0 ? `, ${pixelFailures} states differ from the reference` : ''}${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}`
  if (options.json) ctx.io.out(`${JSON.stringify(proven, null, 2)}\n`)
  ctx.io.out(`${summary}\nevidence: ${join(dir, EVIDENCE_PAGE)}\n`)
  if (manual.length > 0) ctx.io.out(`check by hand: ${manual.map((target) => target.name).join(', ')}\n`)
  if (errors > 0 || failures.length > 0 || pixelFailures > 0) return EXIT_FINDINGS
  if (!isCovered) {
    const missing = full.combos.filter((combo) => !merged.some((entry) => entry.id === comboId(combo))).map(comboLabel)
    ctx.io.err(`jig: ui-matrix proof not recorded, no result for the current working tree for: ${missing.join('; ')}\n`)
    return 0
  }
  recordPassed(root, 'ui-matrix', `jig ui prove: ${merged.length} combinations, 0 audit errors`, ctx.io)
  return 0
}
