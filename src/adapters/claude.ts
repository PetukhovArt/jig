import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathsInCommand, pathsInPatch } from '../context/touched'
import { NATIVE_RULES } from '../context/native'
import { resolveProjectRoot, toProjectPath } from '../core/paths'
import type { EditPair, EventBase, FileEdit, JigEvent, NativeRules, Outcome, SessionSource } from '../hook/types'
import type { AgentAdapter, ParsedHook } from './adapter'
import { AGENT_PROJECT_DIRS, JIG_PROJECT_DIR } from './project-dir'
import { rememberSessionRoot, sessionRoot } from './session-root'

type Json = Record<string, unknown>

const SHELL_CALL = 'shell'
const PATCH_START = '*** Begin Patch'
const PATCH_FILE = /^\*\*\* (Update|Add|Delete) File: (.+)$/

const SESSION_SOURCES: readonly SessionSource[] = ['startup', 'resume', 'clear', 'compact', 'fork']

const HOOK_EVENT_NAMES: Record<JigEvent['kind'], string> = {
  'session-start': 'SessionStart',
  compact: 'PostCompact',
  prompt: 'UserPromptSubmit',
  'pre-edit': 'PreToolUse',
  'pre-patch': 'PreToolUse',
  'post-edit': 'PostToolUse',
  'post-patch': 'PostToolUse',
  touch: 'PostToolUse',
  'instructions-loaded': 'InstructionsLoaded',
  'pre-shell': 'PreToolUse',
  'post-shell': 'PostToolUse',
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

const absoluteOf = (raw: string, paths: PathContext): string => (isAbsolute(raw) ? raw : resolve(paths.cwd, raw))

const rawFileOf = (toolName: string | undefined, input: Json): string | undefined =>
  toolName === 'NotebookEdit' ? text(input, 'notebook_path') : (text(input, 'file_path') ?? text(input, 'path') ?? text(input, 'notebook_path'))

const commandOf = (input: Json): string | undefined => {
  const command = input['command']
  if (typeof command === 'string') return command
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) return command.join(' ')
  return undefined
}

const patchOf = (input: Json): string | undefined =>
  [commandOf(input), text(input, 'input'), text(input, 'patch')].find((value) => value?.includes(PATCH_START) === true)

const patchEdits = (patch: string, paths: PathContext): FileEdit[] => {
  const files: FileEdit[] = []
  let current: { file: string; before: string[]; after: string[] } | undefined
  const flush = (): void => {
    if (current !== undefined) files.push({ file: current.file, edits: [{ before: current.before.join('\n'), after: current.after.join('\n') }] })
  }
  for (const line of patch.split(/\r?\n/)) {
    const header = PATCH_FILE.exec(line)
    if (header !== null) {
      flush()
      current = { file: toProjectPath(paths.projectRoot, absoluteOf((header[2] ?? '').trim(), paths)), before: [], after: [] }
    } else if (current !== undefined && line.startsWith('+') && !line.startsWith('+++')) {
      current.after.push(line.slice(1))
    } else if (current !== undefined && line.startsWith('-') && !line.startsWith('---')) {
      current.before.push(line.slice(1))
    }
  }
  flush()
  return files
}

const preEditEvent = (toolName: string | undefined, input: Json, paths: PathContext): JigEvent | undefined => {
  const patch = patchOf(input)
  if (patch !== undefined) return { kind: 'pre-patch', files: patchEdits(patch, paths) }
  const rawFile = rawFileOf(toolName, input)
  if (rawFile === undefined) return undefined
  const absolute = absoluteOf(rawFile, paths)
  const file = toProjectPath(paths.projectRoot, absolute)
  if (toolName === 'MultiEdit') {
    const edits = multiEditPairs(input)
    return edits === undefined ? undefined : { kind: 'pre-edit', file, edits }
  }
  if (toolName === 'NotebookEdit') {
    return { kind: 'pre-edit', file, edits: [{ before: '', after: text(input, 'new_source') ?? '' }] }
  }
  const content = text(input, 'content')
  if (content !== undefined) {
    return { kind: 'pre-edit', file, edits: [{ before: readCurrent(absolute), after: content }] }
  }
  const before = text(input, 'old_string')
  const after = text(input, 'new_string')
  if (before === undefined || after === undefined) return undefined
  return { kind: 'pre-edit', file, edits: [{ before, after }] }
}

const postEditEvent = (toolName: string | undefined, input: Json, paths: PathContext): JigEvent | undefined => {
  const patch = patchOf(input)
  if (patch !== undefined) return { kind: 'post-patch', files: pathsInPatch(patch, paths.cwd).map((path) => toProjectPath(paths.projectRoot, path)) }
  const rawFile = rawFileOf(toolName, input)
  return rawFile === undefined ? undefined : { kind: 'post-edit', file: toProjectPath(paths.projectRoot, rawFile, paths.cwd) }
}

const touchEvent = (toolName: string | undefined, input: Json, paths: PathContext): JigEvent | undefined => {
  const raw = rawFileOf(toolName, input)
  if (raw === undefined) return undefined
  return { kind: 'touch', paths: [absoluteOf(raw, paths)], read: toolName === 'Read' }
}

const sessionStartEvent = (input: Json): JigEvent => {
  const source = SESSION_SOURCES.find((candidate) => candidate === input['source']) ?? 'startup'
  return { kind: 'session-start', source }
}

const toEvent = (name: string, input: Json, paths: PathContext): JigEvent | undefined => {
  const toolName = text(input, 'tool_name')
  const toolInput = isObject(input['tool_input']) ? input['tool_input'] : {}
  switch (name) {
    case 'session-start':
      return sessionStartEvent(input)
    case 'compact':
      return { kind: 'compact' }
    case 'user-prompt-submit':
      return { kind: 'prompt' }
    case 'pre-edit':
      return preEditEvent(toolName, toolInput, paths)
    case 'post-edit':
      return postEditEvent(toolName, toolInput, paths)
    case 'touch':
      return touchEvent(toolName, toolInput, paths)
    case 'instructions-loaded': {
      const file = text(input, 'file_path')
      return file === undefined ? undefined : { kind: 'instructions-loaded', file: absoluteOf(file, paths) }
    }
    case 'pre-shell':
      return { kind: 'pre-shell', callId: text(input, 'tool_use_id') ?? SHELL_CALL }
    case 'post-shell': {
      const touched = pathsInCommand(commandOf(toolInput) ?? '', paths.cwd)
      const event: JigEvent = { kind: 'post-shell', callId: text(input, 'tool_use_id') ?? SHELL_CALL, isBackground: toolInput['run_in_background'] === true }
      return touched.length === 0 ? event : { ...event, paths: touched }
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

const parserFor =
  (projectDirEnvs: readonly string[]) =>
  (name: string, raw: string, env: NodeJS.ProcessEnv = process.env): ParsedHook | undefined => {
    const input = parseJson(raw)
    if (!isObject(input)) return undefined
    const sessionId = text(input, 'session_id') ?? text(input, 'sessionId')
    if (sessionId === undefined) return undefined
    const cwd = resolve(text(input, 'cwd') ?? process.cwd())
    const fromEnv = projectDirEnvs.some((name) => env[name] !== undefined && env[name] !== '')
    const remembered = fromEnv || name === 'session-start' ? undefined : sessionRoot(sessionId)
    const projectRoot = remembered ?? resolveProjectRoot(cwd, env, projectDirEnvs)
    if (!fromEnv && name === 'session-start') rememberSessionRoot(sessionId, projectRoot)
    const event = toEvent(name, input, { projectRoot, cwd })
    if (event === undefined) return undefined
    const agentId = text(input, 'agent_id')
    const base: EventBase = agentId === undefined ? { sessionId, projectRoot, cwd } : { sessionId, agentId, projectRoot, cwd }
    return { event, base }
  }

export const parseHookInput = parserFor([JIG_PROJECT_DIR, AGENT_PROJECT_DIRS.claude])

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

const compatible = (name: string, native: NativeRules, projectDirEnvs: readonly string[]): AgentAdapter => ({
  name,
  attributesShell: true,
  native,
  parseHookInput: parserFor(projectDirEnvs),
  formatOutcome,
})

export const claude: AgentAdapter = compatible('claude', NATIVE_RULES.claude, [JIG_PROJECT_DIR, AGENT_PROJECT_DIRS.claude])
export const codex: AgentAdapter = compatible('codex', NATIVE_RULES.codex, [JIG_PROJECT_DIR])
export const opencode: AgentAdapter = compatible('opencode', NATIVE_RULES.opencode, [JIG_PROJECT_DIR])
export const grok: AgentAdapter = compatible('grok', NATIVE_RULES.grok, [JIG_PROJECT_DIR, AGENT_PROJECT_DIRS.claude])
