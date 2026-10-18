import { createHash } from 'node:crypto'
import type { RuleId } from '../core/config'
import type { JournalEntry } from '../core/journal'
import { ensureJigDir, jigPaths, resolvePluginRoot, resolveProjectRoot, toProjectPath, toSlash } from '../core/paths'
import { isRuntimeVisible, isTestFile, loadPlan, type Plan } from '../core/plan'
import { acquireLock, transferLock } from '../core/proc'
import { takeSnapshot, turnDiff, type TurnDiff } from '../core/snapshot'
import { resetSnapshot, type SessionState } from '../core/state'
import { addRunDecision, readActiveRun } from '../dash/dash'
import type { Outcome } from '../hook/types'
import { runEslint } from '../tools/eslint'
import { collapseFindings, formatFindings, POST_EDIT_LINE_LIMIT, STOP_LINE_LIMIT, type Finding } from '../tools/finding'
import { runStratum } from '../tools/stratum'
import { changedLines, isOnChangedLine, type ToolRun } from '../tools/tool'
import { groupByTsconfig, runTypeCheck } from '../tools/tsc'
import { applyLevel, checkEdit, isCodeFile, ruleLevel } from './edit'

type Command = (args: string[]) => number | Promise<number>

export type JournalNote = Omit<JournalEntry, 'session' | 'agent'>

export type GateTimes = Pick<SessionState, 'lastTestEditAt' | 'testReviewAt' | 'lastRuntimeEditAt' | 'verifyAt'>

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
  times?: GateTimes
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

export const TYPES_TIMEOUT_MS = 60_000
export const ESLINT_TIMEOUT_MS = 30_000
export const STRATUM_TIMEOUT_MS = 15_000
export const STOP_HARD_LIMIT_MS = 110_000
export const MAX_CONSECUTIVE_BLOCKS = 3

const EXIT_FINDINGS = 1
const EXIT_USAGE = 2
const NONE: Outcome = { type: 'none' }
const SKIP_VERIFY = 'skip-verify'

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

type Budget = ReturnType<typeof createBudget>

interface HeavyLock {
  path: string
  isTransferred: boolean
}

const onChangedLines = (projectRoot: string, findings: readonly Finding[]): Finding[] => {
  if (findings.length === 0) return []
  const lines = changedLines(projectRoot, [...new Set(findings.map((finding) => finding.file))])
  return findings.filter((finding) => isOnChangedLine(lines.get(finding.file), finding.line))
}

const typesStep = (input: StopChecksInput, budget: Budget, lock: HeavyLock, notes: JournalNote[]): Promise<StopStep> =>
  timed('gate/tsc', async () => {
    const level = ruleLevel(input.plan, 'gate/tsc')
    if (level === 'off') return { runs: [], findings: [] }
    const { groups, skipped } = groupByTsconfig(input.projectRoot, input.diff.files)
    for (const file of skipped) {
      notes.push({ kind: 'gate-skipped', tool: 'jig', rule: 'gate/tsc', file, message: 'no tsconfig covers the file' })
    }
    const runs: ToolRun[] = []
    for (const group of groups) {
      const timeoutMs = budget(TYPES_TIMEOUT_MS)
      if (timeoutMs === 0) break
      const toolRun = await runTypeCheck(input.plan.tools, input.projectRoot, group, timeoutMs, lock.path)
      if (toolRun === undefined) continue
      runs.push(toolRun)
      if (toolRun.detachedPid !== undefined) {
        transferLock(lock.path, toolRun.detachedPid)
        lock.isTransferred = true
        break
      }
    }
    const findings = onChangedLines(input.projectRoot, runs.flatMap((toolRun) => toolRun.findings))
    return { runs, findings: applyLevel(findings, level) }
  })

const eslintStep = (input: StopChecksInput, budget: Budget): Promise<StopStep> =>
  timed('gate/eslint', async () => {
    const level = ruleLevel(input.plan, 'gate/eslint')
    const files = input.diff.files.filter(isCodeFile)
    const timeoutMs = budget(ESLINT_TIMEOUT_MS)
    const tool = input.plan.tools.eslint
    const isSkipped = level === 'off' || files.length === 0 || timeoutMs === 0
    if (isSkipped || tool === undefined) return { runs: [], findings: [] }
    const toolRun = await runEslint(tool, input.projectRoot, files, timeoutMs)
    const onChanged = onChangedLines(input.projectRoot, toolRun.findings.filter(isBlocking))
    return { runs: [toolRun], findings: applyLevel(onChanged, level) }
  })

const stratumStep = (input: StopChecksInput, budget: Budget): Promise<StopStep> =>
  timed('gate/stratum', async () => {
    const level = ruleLevel(input.plan, 'gate/stratum')
    const files = input.diff.files.filter(isCodeFile)
    const timeoutMs = budget(STRATUM_TIMEOUT_MS)
    const tool = input.plan.tools.stratum
    const isSkipped = level === 'off' || files.length === 0 || timeoutMs === 0
    if (isSkipped || tool === undefined) return { runs: [], findings: [] }
    const toolRun = await runStratum(tool, input.projectRoot, files, timeoutMs)
    return { runs: [toolRun], findings: applyLevel(toolRun.findings, level) }
  })

const latestEdit = (diff: TurnDiff, files: readonly string[], recorded: number | undefined): number =>
  Math.max(recorded ?? 0, ...files.map((file) => diff.stamps[file]?.mtimeMs ?? 0))

const jigFinding = (rule: RuleId, file: string, message: string): Finding => ({
  tool: 'jig',
  rule,
  severity: 'error',
  file,
  line: 1,
  message,
})

const testReviewFindings = (input: StopChecksInput, times: GateTimes): Finding[] => {
  const tests = input.diff.files.filter(isTestFile)
  const [first] = tests
  if (first === undefined) return []
  const lastTestEdit = latestEdit(input.diff, tests, times.lastTestEditAt)
  const isReviewed = times.testReviewAt !== undefined && times.testReviewAt >= lastTestEdit
  if (isReviewed) return []
  const root = toSlash(input.pluginRoot)
  const message =
    `jig/test-review: test files changed (${tests.join(', ')}) and no test-reviewer ran after the last change. ` +
    `Spawn a subagent with the role template ${root}/skills/jig/references/roles/test-reviewer.md over these files, then fix what it reports.`
  return applyLevel([jigFinding('jig/test-review', first, message)], ruleLevel(input.plan, 'jig/test-review'))
}

const hasSkipVerifyDecision = (projectRoot: string, since: number): boolean => {
  const active = readActiveRun(projectRoot)
  if (active === undefined) return false
  return active.run.decisions.some(
    (decision) => decision.text.startsWith(SKIP_VERIFY) && (decision.why ?? '').trim() !== '' && Date.parse(decision.at) > since,
  )
}

const verifyFactFindings = (input: StopChecksInput, times: GateTimes, notes: JournalNote[]): Finding[] => {
  if (input.plan.tools.agentView === undefined) return []
  const visible = input.diff.files.filter(isRuntimeVisible)
  const [first] = visible
  if (first === undefined) return []
  const lastRuntimeEdit = latestEdit(input.diff, visible, times.lastRuntimeEditAt)
  const isVerified = times.verifyAt !== undefined && times.verifyAt >= lastRuntimeEdit
  if (isVerified) return []
  if (hasSkipVerifyDecision(input.projectRoot, lastRuntimeEdit)) {
    notes.push({ kind: 'skip-verify', tool: 'jig', rule: 'jig/verify-fact', file: first })
    return []
  }
  const root = toSlash(input.pluginRoot)
  const message =
    `jig/verify-fact: runtime-visible files changed (${visible.length}: ${visible.slice(0, 3).join(', ')}) and the app was not checked since. ` +
    `Verify on the running app (agent-view: act replay or the verify skill), or record why not: node ${root}/bin/jig.mjs dash decision "skip-verify" --why "<reason>".`
  return applyLevel([jigFinding('jig/verify-fact', first, message)], ruleLevel(input.plan, 'jig/verify-fact'))
}

const stateStep = (rule: RuleId, findings: () => Finding[]): Promise<StopStep> =>
  timed(rule, () => Promise.resolve({ runs: [], findings: findings() }))

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
    try {
      const heavySteps = [() => typesStep(input, budget, lock, notes), () => eslintStep(input, budget), () => stratumStep(input, budget)]
      for (const step of heavySteps) {
        if (isStopped()) break
        steps.push(await step())
      }
    } finally {
      if (!lock.isTransferred) {
        acquired.release()
      }
    }
  }
  const times = input.times
  if (times !== undefined && !isStopped()) {
    steps.push(await stateStep('jig/test-review', () => testReviewFindings(input, times)))
  }
  if (times !== undefined && !isStopped()) {
    steps.push(await stateStep('jig/verify-fact', () => verifyFactFindings(input, times, notes)))
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
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan, diff, times: state })
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
