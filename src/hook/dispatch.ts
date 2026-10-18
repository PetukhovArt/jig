import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAdapter, type AgentAdapter } from '../adapters'
import { formatAtomDelivery, formatSessionAtoms, selectAtoms } from '../atoms/atoms'
import { loadConfig, type JigConfig } from '../core/config'
import { activeRunContext } from '../dash/dash'
import { appendJournal, rotateJournal, type JournalEntry } from '../core/journal'
import { ensureJigDir, resolvePluginRoot, toSlash } from '../core/paths'
import { CHECKS } from '../checks'
import { loadPlan, type PlanAtom } from '../core/plan'
import { takeSnapshot } from '../core/snapshot'
import {
  createSessionState,
  MAIN_AGENT,
  pruneStates,
  readState,
  resetSnapshot,
  stampCheck,
  writeState,
  type SessionState,
} from '../core/state'
import { checkComments } from '../rules/comments'
import { checkNoVerify } from '../rules/no-verify'
import { checkProtectedPath, checkShellWrite } from '../rules/protected'
import type { Edit } from '../rules/rule'
import { checkSuppressions } from '../rules/suppressions'
import { checkEdit } from '../gates/edit'
import { stopGate } from '../gates/stop'
import {
  collapseFindings,
  formatDenial,
  limitLines,
  POST_EDIT_LINE_LIMIT,
  type Finding,
} from '../tools/finding'
import type { EventBase, JigEvent, Outcome } from './types'

type Command = (args: string[]) => number | Promise<number>

export type { EditPair, EventBase, JigEvent, Outcome, SessionSource } from './types'

interface HookContext extends EventBase {
  pluginRoot: string
  agent: string
  turn?: number
}

type EventOf<K extends JigEvent['kind']> = Extract<JigEvent, { kind: K }>

const NONE: Outcome = { type: 'none' }
const SUBAGENT_ATOM_LIMIT = 10
const GUARDED_KINDS: ReadonlySet<JigEvent['kind']> = new Set(['pre-edit', 'pre-bash'])
const AGENT_FLAG = '--agent'

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const journal = (ctx: HookContext, entry: Omit<JournalEntry, 'session' | 'agent'>): void => {
  try {
    const turn = ctx.turn ?? readState(ctx.projectRoot, ctx.sessionId)?.turn
    appendJournal(ctx.projectRoot, { session: ctx.sessionId, agent: ctx.agent, ...entry, ...(turn === undefined ? {} : { turn }) })
  } catch {
    return
  }
}

const journalFailure = (ctx: HookContext, error: unknown): void => {
  journal(ctx, { kind: 'hook-failure', tool: 'jig', message: errorMessage(error) })
}

const guardFailure = (ctx: HookContext, error: unknown): Outcome => {
  journalFailure(ctx, error)
  const root = toSlash(ctx.pluginRoot)
  return {
    type: 'deny',
    reason: `jig: guard failed (${errorMessage(error)}); the action is blocked. Run "node ${root}/bin/jig.mjs doctor" and report it`,
  }
}

const trackTurn = (ctx: HookContext, state: SessionState): SessionState => {
  ctx.turn = state.turn
  return state
}

const openSession = (ctx: HookContext): SessionState =>
  trackTurn(ctx, readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, takeSnapshot(ctx.projectRoot)))

const deliverAtoms = (ctx: HookContext, state: SessionState, file: string): string[] => {
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot)
  const delivered = state.delivered[ctx.agent] ?? []
  const atoms = selectAtoms(plan.atoms, file, delivered)
  const names: string[] = []
  const texts: string[] = []
  for (const atom of atoms) {
    try {
      texts.push(formatAtomDelivery(atom, file))
      names.push(atom.name)
    } catch (error) {
      journalFailure(ctx, error)
    }
  }
  if (names.length === 0) return []
  state.delivered[ctx.agent] = [...delivered, ...names]
  if (ctx.agent === MAIN_AGENT) {
    state.sessionAtoms = [...state.sessionAtoms.filter((name) => !names.includes(name)), ...names]
  }
  for (const name of names) {
    journal(ctx, { kind: 'atom', tool: 'jig', rule: name, file })
  }
  return texts
}

const contextOf = (parts: readonly string[]): Outcome =>
  parts.length === 0 ? NONE : { type: 'context', text: parts.join('\n') }

const compactRunLine = (ctx: HookContext, now: number): string | undefined => {
  try {
    return activeRunContext(ctx.projectRoot, new Date(now))
  } catch (error) {
    journalFailure(ctx, error)
    return undefined
  }
}

const sessionStart = (event: EventOf<'session-start'>, ctx: HookContext): Outcome => {
  const now = Date.now()
  ensureJigDir(ctx.projectRoot)
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot)
  pruneStates(ctx.projectRoot, now)
  rotateJournal(ctx.projectRoot, now)
  const snapshot = takeSnapshot(ctx.projectRoot)
  const state = readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, snapshot)
  resetSnapshot(state, snapshot)
  trackTurn(ctx, state)
  const parts: string[] = []
  if (event.source === 'compact') {
    state.delivered[MAIN_AGENT] = []
    const runLine = compactRunLine(ctx, now)
    if (runLine !== undefined) {
      parts.push(runLine)
    }
  }
  writeState(ctx.projectRoot, state)
  if (plan.config.error !== undefined) {
    parts.push(`jig: .jig/config.jsonc is invalid (${plan.config.error}); defaults are used`)
  }
  return contextOf(parts)
}

const prompt = (ctx: HookContext): Outcome => {
  const state = openSession(ctx)
  resetSnapshot(state, takeSnapshot(ctx.projectRoot))
  state.turn += 1
  ctx.turn = state.turn
  writeState(ctx.projectRoot, state)
  return NONE
}

type Check = () => Finding | Finding[] | undefined

const runOpenCheck = (ctx: HookContext, check: Check): Finding[] => {
  try {
    return [check() ?? []].flat()
  } catch (error) {
    journalFailure(ctx, error)
    return []
  }
}

const settleFindings = (ctx: HookContext, findings: readonly Finding[]): Outcome => {
  const denial = findings.find((finding) => finding.severity === 'error')
  if (denial !== undefined) {
    journal(ctx, { kind: 'deny', tool: 'jig', rule: denial.rule, file: denial.file, line: denial.line, message: denial.message })
    return { type: 'deny', reason: formatDenial(denial) }
  }
  if (findings.length === 0) return NONE
  for (const finding of findings) {
    journal(ctx, { kind: 'finding', tool: 'jig', rule: finding.rule, file: finding.file, line: finding.line, message: finding.message })
  }
  try {
    const state = openSession(ctx)
    state.pendingWarnings = [...state.pendingWarnings, ...collapseFindings(findings)]
    writeState(ctx.projectRoot, state)
  } catch (error) {
    journalFailure(ctx, error)
  }
  return NONE
}

const runChecks = (ctx: HookContext, guard: Check, openChecks: readonly Check[]): Outcome => {
  let guarded: Finding[]
  try {
    guarded = [guard() ?? []].flat()
  } catch (error) {
    return guardFailure(ctx, error)
  }
  const findings = [...guarded]
  for (const check of openChecks) {
    if (findings.some((finding) => finding.severity === 'error')) break
    findings.push(...runOpenCheck(ctx, check))
  }
  return settleFindings(ctx, findings)
}

const readCurrent = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const locateEdits = (event: EventOf<'pre-edit'>, projectRoot: string): Edit[] => {
  if (event.wholeFile !== undefined) return event.edits.map((edit) => ({ ...edit, line: 1, prefix: '' }))
  const current = readCurrent(join(projectRoot, event.file))
  return event.edits.map((edit) => {
    const at = edit.before === '' ? -1 : current.indexOf(edit.before)
    if (at === -1) return edit
    const prefix = current.slice(0, at)
    return { ...edit, line: prefix.split('\n').length, prefix }
  })
}

const preEdit = (event: EventOf<'pre-edit'>, ctx: HookContext): Outcome => {
  let config: JigConfig | undefined
  const guard: Check = () => {
    config = loadConfig(ctx.projectRoot)
    return checkProtectedPath(event.file, config)
  }
  const withConfig = (check: (loaded: JigConfig) => Finding[]): Check => () => (config === undefined ? [] : check(config))
  const edits = locateEdits(event, ctx.projectRoot)
  return runChecks(ctx, guard, [
    withConfig((loaded) => checkSuppressions(event.file, edits, loaded)),
    withConfig((loaded) => checkComments(event.file, edits, loaded)),
  ])
}

const preBash = (event: EventOf<'pre-bash'>, ctx: HookContext): Outcome => {
  let config: JigConfig | undefined
  const guard: Check = () => {
    config = loadConfig(ctx.projectRoot)
    return checkNoVerify(event.command, { projectRoot: ctx.projectRoot, sessionId: ctx.sessionId, config })
  }
  const shellWrite: Check = () => (config === undefined ? undefined : checkShellWrite(event.command, config, { projectRoot: ctx.projectRoot, cwd: ctx.cwd }))
  return runChecks(ctx, guard, [shellWrite])
}

const editToolFindings = async (ctx: HookContext, file: string): Promise<Finding[]> => {
  let runs: Awaited<ReturnType<typeof checkEdit>>
  try {
    runs = await checkEdit(loadPlan(ctx.projectRoot, ctx.pluginRoot), ctx.projectRoot, file)
  } catch (error) {
    journalFailure(ctx, error)
    return []
  }
  for (const toolRun of runs) {
    if (toolRun.failure !== undefined) {
      journal(ctx, { kind: 'tool-failure', tool: toolRun.tool, file, message: toolRun.failure, durationMs: toolRun.durationMs })
    }
    for (const finding of toolRun.findings) {
      journal(ctx, { kind: 'finding', tool: finding.tool, rule: finding.rule, file: finding.file, line: finding.line, message: finding.message })
    }
  }
  return runs.flatMap((toolRun) => toolRun.findings)
}

const postEdit = async (event: EventOf<'post-edit'>, ctx: HookContext): Promise<Outcome> => {
  const now = Date.now()
  const state = openSession(ctx)
  state.edits.push({ path: event.file, at: now, agent: ctx.agent })
  const parts: string[] = []
  for (const check of CHECKS) {
    stampCheck(state, check.name, check.requires(event.file), 'editAt', now)
  }
  const toolFindings = await editToolFindings(ctx, event.file)
  const toolLines = collapseFindings(toolFindings)
  const findingLines = [...toolLines, ...state.pendingWarnings]
  const shown = limitLines(findingLines, POST_EDIT_LINE_LIMIT, ctx.pluginRoot)
  const isTruncated = shown.length < findingLines.length
  const toolShownCount = isTruncated ? Math.min(toolLines.length, POST_EDIT_LINE_LIMIT - 1) : toolLines.length
  parts.push(...shown.slice(0, toolShownCount))
  parts.push(...deliverAtoms(ctx, state, event.file))
  parts.push(...shown.slice(toolShownCount))
  state.pendingWarnings = []
  writeState(ctx.projectRoot, state)
  return contextOf(parts)
}

const postRead = (event: EventOf<'post-read'>, ctx: HookContext): Outcome => {
  const state = openSession(ctx)
  const parts = deliverAtoms(ctx, state, event.file)
  if (parts.length === 0) return NONE
  writeState(ctx.projectRoot, state)
  return contextOf(parts)
}

const postBash = (event: EventOf<'post-bash'>, ctx: HookContext): Outcome => {
  if (!event.ok) return NONE
  const proofs = CHECKS.map((check) => ({ name: check.name, kinds: check.proves(event.command) })).filter((proof) => proof.kinds.length > 0)
  if (proofs.length === 0) return NONE
  const now = Date.now()
  const state = openSession(ctx)
  for (const proof of proofs) {
    stampCheck(state, proof.name, proof.kinds, 'proofAt', now)
  }
  writeState(ctx.projectRoot, state)
  return NONE
}

const subagentStart = (ctx: HookContext): Outcome => {
  const state = readState(ctx.projectRoot, ctx.sessionId)
  if (state === undefined || state.sessionAtoms.length === 0) return NONE
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot)
  const recent = state.sessionAtoms.slice(-SUBAGENT_ATOM_LIMIT)
  const atoms = recent
    .map((name) => plan.atoms.find((atom) => atom.name === name))
    .filter((atom): atom is PlanAtom => atom !== undefined)
  if (atoms.length === 0) return NONE
  return { type: 'context', text: formatSessionAtoms(atoms, ctx.pluginRoot) }
}

const stop = async (event: EventOf<'stop'>, ctx: HookContext): Promise<Outcome> => {
  const state = openSession(ctx)
  const verdict = await stopGate({ projectRoot: ctx.projectRoot, pluginRoot: ctx.pluginRoot, state, stopHookActive: event.stopHookActive })
  writeState(ctx.projectRoot, state)
  for (const note of verdict.notes) {
    journal(ctx, note)
  }
  return verdict.outcome
}

const route = (event: JigEvent, ctx: HookContext): Outcome | Promise<Outcome> => {
  switch (event.kind) {
    case 'session-start':
      return sessionStart(event, ctx)
    case 'prompt':
      return prompt(ctx)
    case 'pre-edit':
      return preEdit(event, ctx)
    case 'pre-bash':
      return preBash(event, ctx)
    case 'post-edit':
      return postEdit(event, ctx)
    case 'post-read':
      return postRead(event, ctx)
    case 'post-bash':
      return postBash(event, ctx)
    case 'subagent-start':
      return subagentStart({ ...ctx, agent: event.agentId })
    case 'stop':
      return stop(event, ctx)
  }
}

export const dispatch = async (event: JigEvent, base: EventBase, pluginRoot: string = resolvePluginRoot()): Promise<Outcome> => {
  const ctx: HookContext = { ...base, pluginRoot, agent: base.agentId ?? MAIN_AGENT }
  try {
    return await route(event, ctx)
  } catch (error) {
    if (GUARDED_KINDS.has(event.kind)) return guardFailure(ctx, error)
    journalFailure(ctx, error)
    return NONE
  }
}

export const handleHook = async (
  name: string,
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
  adapter: AgentAdapter = resolveAdapter(),
): Promise<string> => {
  let parsed: ReturnType<AgentAdapter['parseHookInput']>
  try {
    parsed = adapter.parseHookInput(name, raw, env)
  } catch {
    return ''
  }
  if (parsed === undefined) return ''
  const outcome = await dispatch(parsed.event, parsed.base, resolvePluginRoot(env))
  return adapter.formatOutcome(parsed.event.kind, outcome)
}

export const parseHookArgs = (args: readonly string[]): { name: string; adapter: AgentAdapter } => {
  const at = args.indexOf(AGENT_FLAG)
  if (at === -1) return { name: args[0] ?? '', adapter: resolveAdapter() }
  const agent = args[at + 1]
  if (agent === undefined) throw new Error(`${AGENT_FLAG} needs an agent name`)
  const positional = args.filter((_, index) => index !== at && index !== at + 1)
  return { name: positional[0] ?? '', adapter: resolveAdapter(agent) }
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export const runHook: Command = async (args) => {
  const { name, adapter } = parseHookArgs(args)
  try {
    const output = await handleHook(name, await readStdin(), process.env, adapter)
    if (output !== '') {
      process.stdout.write(output)
    }
  } catch {
    return 0
  }
  return 0
}
