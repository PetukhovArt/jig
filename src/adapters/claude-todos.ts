import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TodoItem, TodoStatus } from '../hook/types'

type Json = Record<string, unknown>

export const TRANSCRIPT_TAIL_BYTES = 8 * 1024 * 1024
export const TASK_FILE_MAX_BYTES = 64 * 1024
export const TASK_FILES_MAX = 500

const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']
const DELETED = 'deleted'
const SAFE_ID = /^[\w.-]+$/
const CREATED_ID = /Task #(\S+) created/

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (object: Json, key: string): string | undefined => {
  const value = object[key]
  return typeof value === 'string' ? value : undefined
}

const idOf = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined

const statusOf = (value: unknown): TodoStatus | undefined => STATUSES.find((status) => status === value)

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const readTail = (path: string, maxBytes: number): string | undefined => {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    const tail = buffer.toString('utf8')
    return length < size ? tail.slice(tail.indexOf('\n') + 1) : tail
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const todoWriteItems = (input: Json): TodoItem[] | undefined => {
  const todos = input['todos']
  if (!Array.isArray(todos)) return undefined
  return todos.flatMap((todo) => {
    if (!isObject(todo)) return []
    const content = text(todo, 'content')
    const status = statusOf(todo['status'])
    return content === undefined || status === undefined ? [] : [{ text: content, status }]
  })
}

const blocksOf = (entry: Json): Json[] => {
  const message = entry['message']
  const content = isObject(message) ? message['content'] : undefined
  return Array.isArray(content) ? content.filter(isObject) : []
}

const resultText = (block: Json): string => {
  const content = block['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (isObject(part) ? (text(part, 'text') ?? '') : '')).join('\n')
}

const createdTaskId = (entry: Json, block: Json): string | undefined => {
  const result = entry['toolUseResult']
  const task = isObject(result) ? result['task'] : undefined
  return (isObject(task) ? idOf(task['id']) : undefined) ?? CREATED_ID.exec(resultText(block))?.[1]
}

class Replay {
  todoWrite: TodoItem[] | undefined
  readonly tasks = new Map<string, TodoItem>()
  private readonly creates = new Map<string, string>()
  private readonly updates = new Map<string, Json>()

  assistant(entry: Json): void {
    for (const block of blocksOf(entry)) {
      if (block['type'] !== 'tool_use') continue
      const useId = text(block, 'id')
      const input = isObject(block['input']) ? block['input'] : {}
      const name = text(block, 'name')
      if (name === 'TodoWrite') {
        this.todoWrite = todoWriteItems(input) ?? this.todoWrite
      }
      const subject = text(input, 'subject')
      if (name === 'TaskCreate' && useId !== undefined && subject !== undefined) {
        this.creates.set(useId, subject)
      }
      if (name === 'TaskUpdate' && useId !== undefined) {
        this.updates.set(useId, input)
      }
    }
  }

  user(entry: Json): void {
    for (const block of blocksOf(entry)) {
      const useId = block['type'] === 'tool_result' ? text(block, 'tool_use_id') : undefined
      if (useId === undefined) continue
      const subject = this.creates.get(useId)
      const update = this.updates.get(useId)
      this.creates.delete(useId)
      this.updates.delete(useId)
      if (block['is_error'] === true) continue
      const taskId = subject === undefined ? undefined : createdTaskId(entry, block)
      if (subject !== undefined && taskId !== undefined) {
        this.tasks.set(taskId, { text: subject, status: 'pending' })
      }
      if (update !== undefined) {
        this.update(update)
      }
    }
  }

  private update(input: Json): void {
    const taskId = idOf(input['taskId'])
    const task = taskId === undefined ? undefined : this.tasks.get(taskId)
    if (taskId === undefined || task === undefined) return
    if (input['status'] === DELETED) {
      this.tasks.delete(taskId)
      return
    }
    this.tasks.set(taskId, { text: text(input, 'subject') ?? task.text, status: statusOf(input['status']) ?? task.status })
  }
}

const replayTranscript = (transcript: string): TodoItem[] | undefined => {
  const replay = new Replay()
  for (const line of transcript.split('\n')) {
    const entry = line.trim() === '' ? undefined : parseJson(line)
    if (!isObject(entry) || entry['isSidechain'] === true) continue
    if (entry['type'] === 'assistant') replay.assistant(entry)
    if (entry['type'] === 'user') replay.user(entry)
  }
  if (replay.todoWrite === undefined && replay.tasks.size === 0) return undefined
  return [...(replay.todoWrite ?? []), ...replay.tasks.values()]
}

const taskFileOrder = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true })

const readTaskFile = (path: string): TodoItem | undefined => {
  if (statSync(path).size > TASK_FILE_MAX_BYTES) return undefined
  const task = parseJson(readFileSync(path, 'utf8'))
  if (!isObject(task)) return undefined
  const subject = text(task, 'subject')
  const status = statusOf(task['status'])
  return subject === undefined || status === undefined ? undefined : { text: subject, status }
}

const readTaskStore = (dir: string): TodoItem[] | undefined => {
  try {
    const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort(taskFileOrder).slice(0, TASK_FILES_MAX)
    return names.flatMap((name) => {
      try {
        return readTaskFile(join(dir, name)) ?? []
      } catch {
        return []
      }
    })
  } catch {
    return undefined
  }
}

const configDir = (env: NodeJS.ProcessEnv): string => {
  const fromEnv = env['CLAUDE_CONFIG_DIR']
  return fromEnv === undefined || fromEnv === '' ? join(homedir(), '.claude') : fromEnv
}

export const readTodos = (raw: string, env: NodeJS.ProcessEnv = process.env): readonly TodoItem[] | undefined => {
  try {
    const input = parseJson(raw)
    if (!isObject(input)) return undefined
    const sessionId = text(input, 'session_id')
    const isSafe = sessionId !== undefined && SAFE_ID.test(sessionId)
    const stored = isSafe ? readTaskStore(join(configDir(env), 'tasks', sessionId)) : undefined
    if (stored !== undefined && stored.length > 0) return stored
    const transcriptPath = text(input, 'transcript_path')
    const transcript = transcriptPath === undefined ? undefined : readTail(transcriptPath, TRANSCRIPT_TAIL_BYTES)
    return transcript === undefined ? undefined : replayTranscript(transcript)
  } catch {
    return undefined
  }
}
