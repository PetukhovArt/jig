import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { resolveProjectRoot, toProjectPath } from '../core/paths'
import type { EditPair, EventBase, JigEvent, Outcome, SessionSource } from '../hook/types'
import type { AgentAdapter, ParsedHook } from './adapter'
import { readTodos } from './claude-todos'

type Json = Record<string, unknown>

const SESSION_SOURCES: readonly SessionSource[] = ['startup', 'resume', 'clear', 'compact', 'fork']

const HOOK_EVENT_NAMES: Record<JigEvent['kind'], string> = {
  'session-start': 'SessionStart',
  prompt: 'UserPromptSubmit',
  'pre-edit': 'PreToolUse',
  'post-edit': 'PostToolUse',
  'subagent-start': 'SubagentStart',
  stop: 'Stop',
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (object: Json, key: string): string | undefined => {
  const value = object[key]
  return typeof value === 'string' ? value : undefined
}

const readCurrent = (absolutePath: string): string => {
  try {
    return readFileSync(absolutePath, 'utf8')
  } catch {
    return ''
  }
}

const multiEditPairs = (input: Json): EditPair[] | undefined => {
  const edits = input['edits']
  if (!Array.isArray(edits)) return undefined
  const pairs: EditPair[] = []
  for (const edit of edits) {
    if (!isObject(edit)) return undefined
    const before = text(edit, 'old_string')
    const after = text(edit, 'new_string')
    if (before === undefined || after === undefined) return undefined
    pairs.push({ before, after })
  }
  return pairs
}

interface PathContext {
  projectRoot: string
  cwd: string
}

const preEditEvent = (toolName: string | undefined, input: Json, paths: PathContext): JigEvent | undefined => {
  const rawFile = toolName === 'NotebookEdit' ? text(input, 'notebook_path') : text(input, 'file_path')
  if (rawFile === undefined) return undefined
  const absolute = isAbsolute(rawFile) ? rawFile : resolve(paths.cwd, rawFile)
  const file = toProjectPath(paths.projectRoot, absolute)
  if (toolName === 'Edit') {
    const before = text(input, 'old_string')
    const after = text(input, 'new_string')
    if (before === undefined || after === undefined) return undefined
    return { kind: 'pre-edit', file, edits: [{ before, after }] }
  }
  if (toolName === 'MultiEdit') {
    const edits = multiEditPairs(input)
    return edits === undefined ? undefined : { kind: 'pre-edit', file, edits }
  }
  if (toolName === 'Write') {
    const content = text(input, 'content')
    if (content === undefined) return undefined
    return { kind: 'pre-edit', file, edits: [{ before: readCurrent(absolute), after: content }], wholeFile: content }
  }
  if (toolName === 'NotebookEdit') {
    return { kind: 'pre-edit', file, edits: [{ before: '', after: text(input, 'new_source') ?? '' }] }
  }
  return undefined
}

const toolFile = (input: Json, paths: PathContext): string | undefined => {
  const rawFile = text(input, 'file_path') ?? text(input, 'notebook_path')
  return rawFile === undefined ? undefined : toProjectPath(paths.projectRoot, rawFile, paths.cwd)
}

const toEvent = (name: string, input: Json, paths: PathContext): JigEvent | undefined => {
  const toolName = text(input, 'tool_name')
  const toolInput = isObject(input['tool_input']) ? input['tool_input'] : {}
  switch (name) {
    case 'session-start': {
      const source = SESSION_SOURCES.find((candidate) => candidate === input['source']) ?? 'startup'
      return { kind: 'session-start', source }
    }
    case 'user-prompt-submit':
      return { kind: 'prompt' }
    case 'pre-edit':
      return preEditEvent(toolName, toolInput, paths)
    case 'post-edit': {
      const file = toolFile(toolInput, paths)
      return file === undefined ? undefined : { kind: 'post-edit', file }
    }
    case 'subagent-start': {
      const agentId = text(input, 'agent_id')
      if (agentId === undefined) return undefined
      const prompt = text(input, 'prompt')
      const event: JigEvent = { kind: 'subagent-start', agentId, agentType: text(input, 'agent_type') ?? '' }
      return prompt === undefined ? event : { ...event, prompt }
    }
    case 'stop':
      return { kind: 'stop', stopHookActive: input['stop_hook_active'] === true }
    default:
      return undefined
  }
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export const parseHookInput = (name: string, raw: string, env: NodeJS.ProcessEnv = process.env): ParsedHook | undefined => {
  const input = parseJson(raw)
  if (!isObject(input)) return undefined
  const sessionId = text(input, 'session_id')
  if (sessionId === undefined) return undefined
  const cwd = resolve(text(input, 'cwd') ?? process.cwd())
  const projectRoot = resolveProjectRoot(cwd, env)
  const event = toEvent(name, input, { projectRoot, cwd })
  if (event === undefined) return undefined
  const agentId = text(input, 'agent_id')
  const base: EventBase = agentId === undefined ? { sessionId, projectRoot, cwd } : { sessionId, agentId, projectRoot, cwd }
  return { event, base }
}

export const formatOutcome = (kind: JigEvent['kind'], outcome: Outcome): string => {
  const hookEventName = HOOK_EVENT_NAMES[kind]
  switch (outcome.type) {
    case 'none':
      return ''
    case 'deny':
      return JSON.stringify({
        hookSpecificOutput: { hookEventName, permissionDecision: 'deny', permissionDecisionReason: outcome.reason },
      })
    case 'context':
      return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: outcome.text } })
    case 'block':
      return JSON.stringify({ decision: 'block', reason: outcome.reason })
  }
}

export const claude: AgentAdapter = { name: 'claude', parseHookInput, formatOutcome, readTodos }
