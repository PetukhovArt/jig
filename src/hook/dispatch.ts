import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAdapter, type AgentAdapter } from '../adapters'
import { loadConfig } from '../core/config'
import { activeRunContext } from '../task-status/task-status'
import { appendJournal, rotateJournal, type JournalEntry } from '../core/journal'
import { ensureJigDir, jigPaths, resolvePluginRoot, toSlash } from '../core/paths'
import { configDriftLine, loadPlan } from '../core/plan'
import { changedSince, takeSnapshot, type Snapshot } from '../core/snapshot'
import {
  closeShellCall,
  createSessionState,
  MAIN_AGENT,
  openShellCall,
  openShellCalls,
  pruneStates,
  readState,
  resetSnapshot,
  writeState,
  type SessionState,
} from '../core/state'
import { gateEdit, pruneGateClaims, resetGateAtoms } from '../rules/gate'
import type { Edit } from '../rules/rule'
import { checkEdit } from '../gates/edit'
import { stopGate } from '../gates/stop'
import { collapseFindings, limitLines, POST_EDIT_LINE_LIMIT, type Finding } from '../tools/finding'
import { missingDepsOf, unprovisionedWorktrees, type Unprovisioned } from '../worktree/deps-pool'
import { linkedWorktreeRoot, listWorktrees, samePath } from '../worktree/list'
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

const trackTurn = (ctx: HookContext, state: SessionState): SessionState => {
  ctx.turn = state.turn
  return state
}

const openSession = (ctx: HookContext): SessionState =>
  trackTurn(ctx, readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, takeSnapshot(ctx.projectRoot)))

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

const hasProjectConfig = (projectRoot: string): boolean => {
  const paths = jigPaths(projectRoot)
  return existsSync(paths.config) || existsSync(paths.localConfig)
}

const isDepsPooled = (projectRoot: string): boolean => hasProjectConfig(projectRoot) && loadConfig(projectRoot).worktree?.depsPool !== undefined

const toldWorktrees = (ctx: HookContext, state: SessionState): string[] => state.toldWorktrees?.[ctx.agent] ?? []

const tell = (ctx: HookContext, state: SessionState, checked: readonly string[], missing: readonly Unprovisioned[]): string | undefined => {
  state.toldWorktrees = { ...state.toldWorktrees, [ctx.agent]: [...toldWorktrees(ctx, state), ...checked.map(toSlash)] }
  if (missing.length === 0) return undefined
  const jig = `node "${toSlash(join(ctx.pluginRoot, 'bin', 'jig.mjs'))}"`
  return missing
    .map(({ path, deps }) => {
      const dir = toSlash(path)
      return `jig: worktree ${dir} has no ${deps} of its own. Before tests, a build or a dev server there, run \`${jig} worktree seed "${dir}"\` then \`${jig} worktree deps "${dir}"\` in the foreground: a pool miss installs, which takes minutes.`
    })
    .join('\n')
}

const cwdWorktreeNote = (ctx: HookContext, state: SessionState): string | undefined => {
  const root = linkedWorktreeRoot(ctx.cwd)
  if (root === undefined || toldWorktrees(ctx, state).some((told) => samePath(told, root)) || !isDepsPooled(ctx.projectRoot)) return undefined
  const deps = missingDepsOf(root)
  return tell(ctx, state, [root], deps === undefined ? [] : [{ path: root, deps }])
}

const worktreePathsOf = (ctx: HookContext): string[] | undefined => {
  try {
    return listWorktrees(ctx.projectRoot).map((worktree) => worktree.path)
  } catch (error) {
    journalFailure(ctx, error)
    return undefined
  }
}

const newWorktreesNote = (ctx: HookContext, state: SessionState, before: readonly string[]): string | undefined => {
  const known = [...before, ...toldWorktrees(ctx, state)]
  const missing = unprovisionedWorktrees(ctx.projectRoot).filter((worktree) => !known.some((path) => samePath(path, worktree.path)))
  return tell(ctx, state, missing.map((worktree) => worktree.path), missing)
}

const noteOf = (ctx: HookContext, note: () => string | undefined): string[] => {
  try {
    const text = note()
    return text === undefined ? [] : [text]
  } catch (error) {
    journalFailure(ctx, error)
    return []
  }
}

const sessionStart = (event: EventOf<'session-start'>, ctx: HookContext): Outcome => {
  const now = Date.now()
  ensureJigDir(ctx.projectRoot)
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot)
  pruneStates(ctx.projectRoot, now)
  pruneGateClaims(ctx.projectRoot, now)
  rotateJournal(ctx.projectRoot, now)
  const snapshot = takeSnapshot(ctx.projectRoot)
  const state = readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, snapshot)
  resetSnapshot(state, snapshot)
  trackTurn(ctx, state)
  const parts: string[] = []
  if (event.source === 'compact') {
    resetGateAtoms(ctx.projectRoot, ctx.sessionId, ctx.agent)
    const runLine = compactRunLine(ctx, now)
    if (runLine !== undefined) {
      parts.push(runLine)
    }
  }
  parts.push(...noteOf(ctx, () => cwdWorktreeNote(ctx, state)))
  writeState(ctx.projectRoot, state)
  const driftLine = configDriftLine(plan)
  if (driftLine !== undefined) {
    parts.push(driftLine)
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
  const verdict = gateEdit({
    projectRoot: ctx.projectRoot,
    pluginRoot: ctx.pluginRoot,
    sessionId: ctx.sessionId,
    agent: ctx.agent,
    file: event.file,
    edits: locateEdits(event, ctx.projectRoot),
    config: loadConfig(ctx.projectRoot),
  })
  for (const hit of verdict.hits) {
    journal(ctx, { kind: 'deny', tool: 'jig', rule: hit.rule, file: event.file, ...(hit.line === undefined ? {} : { line: hit.line }), message: hit.message })
  }
  return verdict.reason === undefined ? NONE : { type: 'deny', reason: verdict.reason }
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
  const toolFindings = await editToolFindings(ctx, event.file)
  const findingLines = collapseFindings(toolFindings)
  const worktreeNote = noteOf(ctx, () => cwdWorktreeNote(ctx, state))
  writeState(ctx.projectRoot, state)
  return contextOf([...limitLines(findingLines, POST_EDIT_LINE_LIMIT, ctx.pluginRoot), ...worktreeNote])
}

const preShell = (event: EventOf<'pre-shell'>, ctx: HookContext): Outcome => {
  if (!hasProjectConfig(ctx.projectRoot)) return NONE
  const snapshot = takeSnapshot(ctx.projectRoot)
  const worktrees = isDepsPooled(ctx.projectRoot) ? worktreePathsOf(ctx) : undefined
  openShellCall(ctx.projectRoot, ctx.sessionId, event.callId, worktrees === undefined ? { snapshot } : { snapshot, worktrees })
  return NONE
}

const attributeShellChanges = (ctx: HookContext, state: SessionState, before: Snapshot): void => {
  const at = Date.now()
  for (const path of changedSince(ctx.projectRoot, before)) {
    state.edits.push({ path, at, agent: ctx.agent, via: 'shell' })
  }
}

const postShell = (event: EventOf<'post-shell'>, ctx: HookContext): Outcome => {
  if (event.isBackground) return NONE
  const call = closeShellCall(ctx.projectRoot, ctx.sessionId, event.callId)
  if (call === undefined) return NONE
  const state = openSession(ctx)
  attributeShellChanges(ctx, state, call.snapshot)
  const before = call.worktrees
  const worktreeNote = before === undefined ? [] : noteOf(ctx, () => newWorktreesNote(ctx, state, before))
  writeState(ctx.projectRoot, state)
  return contextOf(worktreeNote)
}

const ROLE_PATH = /\S*[\\/]roles[\\/]([\w-]+)\.md\b/g

const subagentStart = (event: EventOf<'subagent-start'>, ctx: HookContext): Outcome => {
  const prompt = event.prompt?.replace(ROLE_PATH, 'role $1')
  journal(ctx, { kind: 'subagent-start', tool: 'jig', rule: event.agentType, ...(prompt === undefined ? {} : { message: prompt }) })
  return NONE
}

const stop = async (event: EventOf<'stop'>, ctx: HookContext): Promise<Outcome> => {
  const state = openSession(ctx)
  const attributesShell = ctx.attributesShell === true
  if (attributesShell) {
    for (const callId of openShellCalls(ctx.projectRoot, ctx.sessionId)) {
      const call = closeShellCall(ctx.projectRoot, ctx.sessionId, callId)
      if (call !== undefined) attributeShellChanges(ctx, state, call.snapshot)
    }
  }
  const verdict = await stopGate({ projectRoot: ctx.projectRoot, pluginRoot: ctx.pluginRoot, state, stopHookActive: event.stopHookActive, attributesShell })
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
    case 'post-edit':
      return postEdit(event, ctx)
    case 'pre-shell':
      return preShell(event, ctx)
    case 'post-shell':
      return postShell(event, ctx)
    case 'subagent-start':
      return subagentStart(event, { ...ctx, agent: event.agentId })
    case 'stop':
      return stop(event, ctx)
  }
}

export const dispatch = async (event: JigEvent, base: EventBase, pluginRoot: string = resolvePluginRoot()): Promise<Outcome> => {
  const ctx: HookContext = { ...base, pluginRoot, agent: base.agentId ?? MAIN_AGENT }
  try {
    return await route(event, ctx)
  } catch (error) {
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
  const outcome = await dispatch(parsed.event, { ...parsed.base, attributesShell: adapter.attributesShell }, resolvePluginRoot(env))
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
