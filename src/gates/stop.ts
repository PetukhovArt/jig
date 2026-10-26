import { createHash } from 'node:crypto'
import { TOOLS, type RegisteredTool } from '../catalog/tools'
import type { CustomCheck, RuleId } from '../core/config'
import { ensureJigDir, jigPaths, resolvePluginRoot, resolveProjectRoot, toProjectPath } from '../core/paths'
import { loadPlan, type Plan } from '../core/plan'
import { acquireLock, transferLock } from '../core/proc'
import { takeSnapshot, turnDiff, type TurnDiff } from '../core/snapshot'
import { resetSnapshot, type SessionState } from '../core/state'
import { logToActiveJournal } from '../task-status/task-status'
import type { Outcome } from '../hook/types'
import { collapseFindings, formatFindings, POST_EDIT_LINE_LIMIT, STOP_LINE_LIMIT, type Finding } from '../tools/finding'
import type { JournalNote, StopToolInput, ToolRun } from '../tools/tool'
import { checkFiles, checkRule, runCustomCheck } from './custom'
import { applySetting, checkEdit, toolFiles, toolSetting } from './edit'

type Command = (args: string[]) => number | Promise<number>

export type { JournalNote } from '../tools/tool'

export interface StopStep {
  rule: RuleId
  runs: ToolRun[]
  findings: Finding[]
  durationMs: number
}

export interface StopChecksInput {
  projectRoot: string
  pluginRoot: string
  plan: Plan
  diff: TurnDiff
}

export interface StopChecks {
  steps: StopStep[]
  findings: Finding[]
  blocking: Finding[]
  incomplete: string[]
  isLockBusy: boolean
  notes: JournalNote[]
  durationMs: number
}

export interface StopGateInput {
  projectRoot: string
  pluginRoot: string
  state: SessionState
  stopHookActive: boolean
  attributesShell: boolean
}

export interface StopVerdict {
  outcome: Outcome
  notes: JournalNote[]
}

export const STOP_HARD_LIMIT_MS = 110_000
export const MAX_CONSECUTIVE_BLOCKS = 3

const EXIT_FINDINGS = 1
const EXIT_USAGE = 2
const EXIT_INCOMPLETE = 3
const MS_PER_S = 1000
const NONE: Outcome = { type: 'none' }

const isBlocking = (finding: Finding): boolean => finding.severity === 'error'

const failureNotes = (runs: readonly ToolRun[]): JournalNote[] =>
  runs
    .filter((toolRun) => toolRun.failure !== undefined)
    .map((toolRun) => ({ kind: 'tool-failure', tool: toolRun.tool, message: toolRun.failure ?? '', durationMs: toolRun.durationMs }))

const timed = async (rule: RuleId, body: () => Promise<{ runs: ToolRun[]; findings: Finding[] }>): Promise<StopStep> => {
  const startedAt = Date.now()
  const { runs, findings } = await body()
  return { rule, runs, findings, durationMs: Date.now() - startedAt }
}

interface Budget {
  take: (ownMs: number) => number
  isSpent: () => boolean
}

const createBudget = (startedAt: number): Budget => {
  let isSpent = false
  const take = (ownMs: number): number => {
    const ms = Math.max(0, Math.min(ownMs, startedAt + STOP_HARD_LIMIT_MS - Date.now()))
    isSpent ||= ms === 0
    return ms
  }
  return { take, isSpent: () => isSpent }
}

const withTimeout = (budget: StopToolInput['budget'], timeout: number | undefined): StopToolInput['budget'] =>
  timeout === undefined ? budget : () => budget(timeout * MS_PER_S)

interface HeavyLock {
  path: string
  isTransferred: boolean
}

const toolStep = (tool: RegisteredTool, input: StopChecksInput, toolInput: StopToolInput): Promise<StopStep> =>
  timed(tool.rule, async () => {
    const setting = toolSetting(input.plan.config, tool)
    const files = toolFiles(tool, toolInput.files)
    if (setting === undefined || tool.stop === undefined || files.length === 0) return { runs: [], findings: [] }
    const { runs, findings } = await tool.stop(input.plan.tools, { ...toolInput, files, budget: withTimeout(toolInput.budget, setting.timeout) })
    return { runs, findings: applySetting(findings, setting) }
  })

export const CUSTOM_CHECK_TIMEOUT_MS = 30_000

const customStep = (check: CustomCheck, input: StopChecksInput, toolInput: StopToolInput): Promise<StopStep> =>
  timed(checkRule(check), async () => {
    const files = checkFiles(check, toolInput.files)
    const timeoutMs = withTimeout(toolInput.budget, check.timeout)(CUSTOM_CHECK_TIMEOUT_MS)
    if (check.level === 'off' || files.length === 0 || timeoutMs === 0) return { runs: [], findings: [] }
    const toolRun = await runCustomCheck(input.projectRoot, check, files, timeoutMs)
    return { runs: [toolRun], findings: toolRun.findings }
  })

const isStopTool = (tool: RegisteredTool): boolean => tool.stop !== undefined

const LOCK_BUSY = 'the heavy checks lock is busy'

const incompleteReasons = (runs: readonly ToolRun[], isSpent: boolean): string[] => [
  ...runs.flatMap((toolRun) => (toolRun.failure === undefined ? [] : [`${toolRun.tool} did not finish (${toolRun.failure})`])),
  ...(isSpent ? [`the ${STOP_HARD_LIMIT_MS / MS_PER_S} s budget ran out`] : []),
]

const incompleteFinding = (reasons: readonly string[]): Finding => ({
  tool: 'jig',
  rule: 'gate/incomplete',
  severity: 'error',
  file: '',
  line: 0,
  message: `jig: the end-of-turn checks did not finish, so their result is unknown: ${reasons.join('; ')}. Run that tool on this turn's files yourself and fix its errors; a slow tool gets more time from "timeout" (seconds) on its entry in .jig/config.jsonc, which the user sets.`,
})

export const runStopChecks = async (input: StopChecksInput): Promise<StopChecks> => {
  const startedAt = Date.now()
  const budget = createBudget(startedAt)
  const notes: JournalNote[] = []
  const steps: StopStep[] = []
  const isStopped = (): boolean => steps.some((step) => step.findings.some(isBlocking))
  const acquired = await acquireLock(jigPaths(input.projectRoot).heavyLock)
  if (acquired === undefined) {
    notes.push({ kind: 'gate-skipped', tool: 'jig', message: LOCK_BUSY })
  } else {
    const lock: HeavyLock = { path: acquired.path, isTransferred: false }
    const transfer = (pid: number): void => {
      transferLock(lock.path, pid)
      lock.isTransferred = true
    }
    const toolInput: StopToolInput = { projectRoot: input.projectRoot, files: input.diff.files, budget: budget.take, lock: { path: lock.path, transfer }, notes }
    try {
      const queue = [
        ...TOOLS.filter(isStopTool).map((tool) => () => toolStep(tool, input, toolInput)),
        ...input.plan.config.checks.filter((check) => check.on === 'stop').map((check) => () => customStep(check, input, toolInput)),
      ]
      for (const step of queue) {
        if (isStopped()) break
        steps.push(await step())
      }
    } finally {
      if (!lock.isTransferred) {
        acquired.release()
      }
    }
  }
  const findings = steps.flatMap((step) => step.findings)
  const runs = steps.flatMap((step) => step.runs)
  notes.push(...failureNotes(runs))
  const incomplete = incompleteReasons(runs, budget.isSpent())
  const blocking = [...findings.filter(isBlocking), ...(incomplete.length === 0 ? [] : [incompleteFinding(incomplete)])]
  return { steps, findings, blocking, incomplete, isLockBusy: acquired === undefined, notes, durationMs: Date.now() - startedAt }
}

export const findingsFingerprint = (findings: readonly Finding[]): string =>
  createHash('sha1').update(collapseFindings(findings).sort().join('\n')).digest('hex')

export const blockReason = (blocking: readonly Finding[], pluginRoot: string): string => {
  const toolLines = formatFindings(blocking.filter((finding) => finding.tool !== 'jig'), STOP_LINE_LIMIT, pluginRoot)
  const jigLines = blocking.filter((finding) => finding.tool === 'jig').map((finding) => finding.message)
  return [...toolLines, ...jigLines].join('\n')
}

const UNRESOLVED_WHY = 'the stop hook fired again with no new edits since the last block'

const blockNotes = (blocking: readonly Finding[]): JournalNote[] =>
  blocking.map((finding) => ({
    kind: 'gate-block',
    tool: finding.tool,
    rule: finding.rule,
    file: finding.file,
    line: finding.line,
    message: finding.message,
  }))

const foreignChangeNotes = (files: readonly string[]): JournalNote[] =>
  files.length === 0 ? [] : [{ kind: 'foreign-change', tool: 'jig', message: files.join(', ') }]

export const stopGate = async (input: StopGateInput): Promise<StopVerdict> => {
  const { projectRoot, pluginRoot, state } = input
  const diff = turnDiff(projectRoot, state.snapshot, state.edits, input.attributesShell)
  const foreignNotes = foreignChangeNotes(diff.foreign)
  const isQuiet = diff.files.length === 0 || diff.fingerprint === state.stop.lastGreenFingerprint
  if (isQuiet) return { outcome: NONE, notes: foreignNotes }
  const isUnresolved = input.stopHookActive && diff.fingerprint === state.stop.lastBlockDiffFingerprint
  if (isUnresolved) {
    logToActiveJournal(projectRoot, { phase: 'gate', decision: 'gate unresolved', why: UNRESOLVED_WHY })
    return { outcome: NONE, notes: [...foreignNotes, { kind: 'gate-unresolved', tool: 'jig', message: UNRESOLVED_WHY }] }
  }
  const plan = loadPlan(projectRoot, pluginRoot)
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan, diff })
  if (checks.blocking.length === 0) {
    state.stop = { lastGreenFingerprint: diff.fingerprint, consecutiveBlocks: 0 }
    resetSnapshot(state, takeSnapshot(projectRoot))
    return { outcome: NONE, notes: [...foreignNotes, ...checks.notes, { kind: 'gate-pass', tool: 'jig', durationMs: checks.durationMs }] }
  }
  const fingerprint = findingsFingerprint(checks.blocking)
  const isRepeat = fingerprint === state.stop.lastBlockFingerprint
  const consecutiveBlocks = isRepeat ? state.stop.consecutiveBlocks + 1 : 1
  if (consecutiveBlocks > MAX_CONSECUTIVE_BLOCKS) {
    state.stop = { consecutiveBlocks: 0 }
    const [first] = checks.blocking
    const giveUp: JournalNote = { kind: 'gate-giveup', tool: 'jig', durationMs: checks.durationMs, ...(first && { rule: first.rule, file: first.file }) }
    return { outcome: NONE, notes: [...foreignNotes, ...checks.notes, giveUp] }
  }
  state.stop = { ...state.stop, lastBlockFingerprint: fingerprint, consecutiveBlocks, lastBlockDiffFingerprint: diff.fingerprint }
  return {
    outcome: { type: 'block', reason: blockReason(checks.blocking, pluginRoot) },
    notes: [...foreignNotes, ...checks.notes, ...blockNotes(checks.blocking)],
  }
}

const printFailures = (runs: readonly ToolRun[]): void => {
  for (const toolRun of runs) {
    if (toolRun.failure !== undefined) {
      process.stderr.write(`jig: ${toolRun.tool} failed (${toolRun.failure})\n`)
    }
  }
}

/** What `jig check stop` prints: the findings, then why the result is unknown; `clean` only when every check ran to the end. */
export const stopSummary = (checks: Pick<StopChecks, 'findings' | 'incomplete' | 'isLockBusy'>, pluginRoot: string): { text: string; code: number } => {
  const incomplete = [...checks.incomplete, ...(checks.isLockBusy ? [LOCK_BUSY] : [])]
  const lines = [
    ...formatFindings(checks.findings, STOP_LINE_LIMIT, pluginRoot),
    ...(incomplete.length === 0 ? [] : [`incomplete: ${incomplete.join('; ')}`]),
  ]
  if (checks.findings.some(isBlocking)) return { text: lines.join('\n'), code: EXIT_FINDINGS }
  if (incomplete.length > 0) return { text: lines.join('\n'), code: EXIT_INCOMPLETE }
  return { text: lines.length === 0 ? 'clean' : lines.join('\n'), code: 0 }
}

const checkStopCommand = async (projectRoot: string, pluginRoot: string): Promise<number> => {
  const diff = turnDiff(projectRoot, {}, [])
  if (diff.files.length === 0) {
    process.stdout.write('clean\n')
    return 0
  }
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan: loadPlan(projectRoot, pluginRoot), diff })
  const summary = stopSummary(checks, pluginRoot)
  process.stdout.write(`${summary.text}\n`)
  return summary.code
}

const checkEditCommand = async (projectRoot: string, pluginRoot: string, file: string | undefined): Promise<number> => {
  if (file === undefined || file === '') {
    process.stderr.write('jig: check edit needs a file\n')
    return EXIT_USAGE
  }
  const path = toProjectPath(projectRoot, file, process.cwd())
  const runs = await checkEdit(loadPlan(projectRoot, pluginRoot), projectRoot, path)
  printFailures(runs)
  const findings = runs.flatMap((toolRun) => toolRun.findings)
  if (findings.length === 0) return 0
  process.stdout.write(`${formatFindings(findings, POST_EDIT_LINE_LIMIT, pluginRoot).join('\n')}\n`)
  return EXIT_FINDINGS
}

export const runCheck: Command = (args) => {
  const [sub, file] = args
  const projectRoot = resolveProjectRoot(process.cwd())
  const pluginRoot = resolvePluginRoot()
  if (sub === 'stop') {
    ensureJigDir(projectRoot)
    return checkStopCommand(projectRoot, pluginRoot)
  }
  if (sub === 'edit') {
    ensureJigDir(projectRoot)
    return checkEditCommand(projectRoot, pluginRoot, file)
  }
  process.stderr.write(`jig: unknown check ${sub ?? '(none)'}, expected edit or stop\n`)
  return EXIT_USAGE
}
