import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTodos, TASK_FILE_MAX_BYTES, TRANSCRIPT_TAIL_BYTES } from '../src/adapters/claude-todos'
import { toSlash } from '../src/core/paths'

const FIXTURES = join(__dirname, 'fixtures', 'todos')

const TODO_WRITE_LIST = [
  { text: '1. Reproduce', status: 'completed' },
  { text: '2. Fix', status: 'in_progress' },
  { text: 'n/a: 3. Pre-MR, no remote', status: 'pending' },
]

let dir: string

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const hookInput = (fields: Record<string, unknown>): string =>
  JSON.stringify({ session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false, cwd: dir, ...fields })

const env = (): NodeJS.ProcessEnv => ({ CLAUDE_CONFIG_DIR: join(dir, 'config') })

const todosOf = (transcriptPath: string, fields: Record<string, unknown> = {}) =>
  readTodos(hookInput({ transcript_path: transcriptPath, ...fields }), env())

const writeTask = (sessionId: string, name: string, body: string): void => {
  const taskDir = join(dir, 'config', 'tasks', sessionId)
  mkdirSync(taskDir, { recursive: true })
  writeFileSync(join(taskDir, name), body)
}

const writeTranscript = (name: string, text: string): string => {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jig-todos-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('claude todos from the transcript', () => {
  it('replays TaskCreate and TaskUpdate results, skipping errors, sidechains, request blobs and broken lines', () => {
    expect(todosOf(join(FIXTURES, 'tasks.jsonl'))).toEqual([
      { text: '1. Use case', status: 'completed' },
      { text: 'skip: agent-view not configured', status: 'completed' },
      { text: '3. Own review', status: 'pending' },
      { text: '4. Pre-MR', status: 'in_progress' },
    ])
  })

  it('takes the last valid TodoWrite list', () => {
    expect(todosOf(join(FIXTURES, 'todowrite.jsonl'))).toEqual(TODO_WRITE_LIST)
  })

  it('is an empty list without any todo tool call', () => {
    expect(todosOf(writeTranscript('plain.jsonl', '{"type":"user","message":{"content":"hi"}}\nnot json\n'))).toEqual([])
  })

  it('reads a native or a forward-slash path with spaces', () => {
    mkdirSync(join(dir, 'sub dir'))
    const path = writeTranscript(join('sub dir', 'transcript.jsonl'), fixture('todowrite.jsonl'))
    expect(todosOf(path)).toEqual(TODO_WRITE_LIST)
    expect(todosOf(toSlash(path))).toEqual(TODO_WRITE_LIST)
  })

  it('reads only the tail of a huge transcript, so a task created before it is not seen', () => {
    const head = fixture('tasks.jsonl').split('\n').slice(0, 5).join('\n')
    const pad = `{"type":"assistant","message":{"content":[{"type":"text","text":"${'p'.repeat(1024)}"}]}}\n`
    const late = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"late","name":"TaskCreate","input":{"subject":"late step"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"late","content":"Task #7 created successfully: late step"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"upd","name":"TaskUpdate","input":{"taskId":"2","status":"in_progress"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"upd","content":"Updated task #2 status"}]}}',
    ].join('\n')
    const path = writeTranscript('huge.jsonl', `${head}\n${pad.repeat(Math.ceil(TRANSCRIPT_TAIL_BYTES / pad.length) + 16)}${late}\n`)
    expect(todosOf(path)).toEqual([{ text: 'late step', status: 'pending' }])
  })

  it('is an empty list for a missing transcript or a folder, as with --no-session-persistence', () => {
    expect(todosOf(join(dir, 'missing.jsonl'))).toEqual([])
    expect(todosOf(dir)).toEqual([])
    expect(readTodos(hookInput({}), env())).toEqual([])
  })

  it('is undefined for hook input that is not a JSON object', () => {
    expect(readTodos('not json', env())).toBeUndefined()
    expect(readTodos('[]', env())).toBeUndefined()
  })
})

describe('claude todos from the task store', () => {
  it('prefers the session task store over the transcript, in task id order', () => {
    writeTask('sess-1', '10.json', JSON.stringify({ id: '10', subject: 'ten', status: 'pending' }))
    writeTask('sess-1', '2.json', JSON.stringify({ id: '2', subject: 'two', status: 'completed' }))
    writeTask('sess-1', '3.json', '{ broken')
    writeTask('sess-1', '4.json', JSON.stringify({ id: '4', subject: 'x'.repeat(TASK_FILE_MAX_BYTES), status: 'pending' }))
    writeTask('sess-1', '.lock', '')
    writeTask('other', '1.json', JSON.stringify({ id: '1', subject: 'other session', status: 'pending' }))
    expect(todosOf(join(FIXTURES, 'todowrite.jsonl'))).toEqual([
      { text: 'two', status: 'completed' },
      { text: 'ten', status: 'pending' },
    ])
  })

  it('falls back to the transcript when the store is empty', () => {
    writeTask('sess-1', '.lock', '')
    expect(todosOf(join(FIXTURES, 'todowrite.jsonl'))).toEqual(TODO_WRITE_LIST)
  })

  it('does not leave the tasks folder for an unsafe session id', () => {
    writeTask('escape', '1.json', JSON.stringify({ id: '1', subject: 'outside', status: 'pending' }))
    expect(readTodos(hookInput({ session_id: '../tasks/escape' }), env())).toEqual([])
  })
})
