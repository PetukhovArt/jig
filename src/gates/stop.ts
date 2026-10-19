import { createHash } from 'node:crypto'
import type { RuleId } from '../core/config'
import { ensureJigDir, jigPaths, resolvePluginRoot, resolveProjectRoot, toProjectPath } from '../core/paths'
import { loadPlan, type Plan } from '../core/plan'
import { acquireLock, transferLock } from '../core/proc'
import { takeSnapshot, turnDiff, type TurnDiff } from '../core/snapshot'
import { resetSnapshot, type SessionState } from '../core/state'
import { addRunDecision } from '../dash/dash'
import type { Outcome } from '../hook/types'
import { TOOLS, type RegisteredTool } from '../tools'
import { collapseFindings, formatFindings, POST_EDIT_LINE_LIMIT, STOP_LINE_LIMIT, type Finding } from '../tools/finding'
import type { JournalNote, StopToolInput, ToolRun } from '../tools/tool'
import { applyLevel, checkEdit, ruleLevel } from './edit'

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
  notes: JournalNote[]
  durationMs: number
}

export interface StopGateInput {
  projectRoot: string
  pluginRoot: string
  state: SessionState
  stopHookActive: boolean
}

export interface StopVerdict {
  outcome: Outcome
  notes: JournalNote[]
}

export const STOP_HARD_LIMIT_MS = 110_000
export const MAX_CONSECUTIVE_BLOCKS = 3

const EXIT_FINDINGS = 1
const EXIT_USAGE = 2
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

const createBudget = (startedAt: number) => (ownMs: number): number =>
  Math.max(0, Math.min(ownMs, startedAt + STOP_HARD_LIMIT_MS - Date.now()))

interface HeavyLock {
  path: string
  isTransferred: boolean
}

const toolStep = (tool: RegisteredTool, input: StopChecksInput, toolInput: StopToolInput): Promise<StopStep> =>
  timed(tool.rule, async () => {
    const level = ruleLevel(input.plan, tool.rule)
    if (level === 'off' || tool.stop === undefined) return { runs: [], findings: [] }
    const { runs, findings } = await tool.stop(input.plan.tools, toolInput)
    return { runs, findings: applyLevel(findings, level) }
  })

export const runStopChecks = async (input: StopChecksInput): Promise<StopChecks> => {
  const startedAt = Date.now()
  const budget = createBudget(startedAt)
  const notes: JournalNote[] = []
  const steps: StopStep[] = []
  const isStopped = (): boolean => steps.some((step) => step.findings.some(isBlocking))
  const acquired = await acquireLock(jigPaths(input.projectRoot).heavyLock)
  if (acquired === undefined) {
    notes.push({ kind: 'gate-skipped', tool: 'jig', message: 'heavy checks lock is busy' })
  } else {
    const lock: HeavyLock = { path: acquired.path, isTransferred: false }
    const transfer = (pid: number): void => {
      transferLock(lock.path, pid)
      lock.isTransferred = true
    }
    const toolInput: StopToolInput = { projectRoot: input.projectRoot, files: input.diff.files, budget, lock: { path: lock.path, transfer }, notes }
    try {
      for (const tool of TOOLS.filter((candidate) => candidate.stop !== undefined)) {
        if (isStopped()) break
        steps.push(await toolStep(tool, input, toolInput))
      }
    } finally {
      if (!lock.isTransferred) {
        acquired.release()
      }
    }
  }
  const findings = steps.flatMap((step) => step.findings)
  notes.push(...failureNotes(steps.flatMap((step) => step.runs)))
  return { steps, findings, blocking: findings.filter(isBlocking), notes, durationMs: Date.now() - startedAt }
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

export const stopGate = async (input: StopGateInput): Promise<StopVerdict> => {
  const { projectRoot, pluginRoot, state } = input
  const diff = turnDiff(projectRoot, state.snapshot, state.edits)
  const isQuiet = diff.files.length === 0 || diff.fingerprint === state.stop.lastGreenFingerprint
  if (isQuiet) return { outcome: NONE, notes: [] }
  const isUnresolved = input.stopHookActive && diff.fingerprint === state.stop.lastBlockDiffFingerprint
  if (isUnresolved) {
    addRunDecision(projectRoot, 'gate unresolved', UNRESOLVED_WHY)
    return { outcome: NONE, notes: [{ kind: 'gate-unresolved', tool: 'jig', message: UNRESOLVED_WHY }] }
  }
  const plan = loadPlan(projectRoot, pluginRoot)
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan, diff })
  if (checks.blocking.length === 0) {
    state.stop = { lastGreenFingerprint: diff.fingerprint, consecutiveBlocks: 0 }
    resetSnapshot(state, takeSnapshot(projectRoot))
    return { outcome: NONE, notes: [...checks.notes, { kind: 'gate-pass', tool: 'jig', durationMs: checks.durationMs }] }
  }
  const fingerprint = findingsFingerprint(checks.blocking)
  const isRepeat = fingerprint === state.stop.lastBlockFingerprint
  const consecutiveBlocks = isRepeat ? state.stop.consecutiveBlocks + 1 : 1
  if (consecutiveBlocks > MAX_CONSECUTIVE_BLOCKS) {
    state.stop = { consecutiveBlocks: 0 }
    const [first] = checks.blocking
    const giveUp: JournalNote = { kind: 'gate-giveup', tool: 'jig', durationMs: checks.durationMs, ...(first && { rule: first.rule, file: first.file }) }
    return { outcome: NONE, notes: [...checks.notes, giveUp] }
  }
  state.stop = { ...state.stop, lastBlockFingerprint: fingerprint, consecutiveBlocks, lastBlockDiffFingerprint: diff.fingerprint }
  return {
    outcome: { type: 'block', reason: blockReason(checks.blocking, pluginRoot) },
    notes: [...checks.notes, ...blockNotes(checks.blocking)],
  }
}

const printFailures = (runs: readonly ToolRun[]): void => {
  for (const toolRun of runs) {
    if (toolRun.failure !== undefined) {
      process.stderr.write(`jig: ${toolRun.tool} failed (${toolRun.failure})\n`)
    }
  }
}

const checkStopCommand = async (projectRoot: string, pluginRoot: string): Promise<number> => {
  const diff = turnDiff(projectRoot, {}, [])
  if (diff.files.length === 0) {
    process.stdout.write('clean\n')
    return 0
  }
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan: loadPlan(projectRoot, pluginRoot), diff })
  printFailures(checks.steps.flatMap((step) => step.runs))
  if (checks.findings.length === 0) {
    process.stdout.write('clean\n')
    return 0
  }
  process.stdout.write(`${formatFindings(checks.findings, STOP_LINE_LIMIT, pluginRoot).join('\n')}\n`)
  return checks.blocking.length > 0 ? EXIT_FINDINGS : 0
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
