import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { dispatch, handleHook, type EventBase, type Outcome, type TodoItem } from '../src/hook/dispatch'

const pluginRoot = resolve(__dirname, '..')
const FIXTURES = join(__dirname, 'fixtures', 'todos')

let root: string
let base: EventBase

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const stop = (todos: readonly TodoItem[] | undefined, stopHookActive = false): Promise<Outcome> =>
  dispatch({ kind: 'stop', stopHookActive, ...(todos === undefined ? {} : { todos }) }, base, pluginRoot)

const prompt = (): Promise<Outcome> => dispatch({ kind: 'prompt' }, base, pluginRoot)

const todoRecords = () => readJournal(root).filter((record) => record.rule === 'jig/todos').map((record) => record.kind)

const FLOW: TodoItem[] = [
  { text: '1. Use case', status: 'completed' },
  { text: '2. Drive the app', status: 'pending' },
  { text: '3. Own review', status: 'in_progress' },
  { text: 'skip: 4. Pre-MR, no remote', status: 'pending' },
  { text: 'N/A: 5. Slot', status: 'in_progress' },
]

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'jig-stop-todos-'))
  base = { sessionId: 'todos', projectRoot: root, cwd: root }
  git(['init', '-q'], root)
  write('src/a.ts', 'export const a = 1\n')
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
  await dispatch({ kind: 'session-start', source: 'startup' }, base, pluginRoot)
  await prompt()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('stop gate: open todo items', () => {
  it('blocks once with the open items, then lets the same open set stop with a journal note', async () => {
    const first = await stop(FLOW)
    expect(first).toEqual({
      type: 'block',
      reason: [
        'jig/todos: 2 todo item(s) still open:',
        '- [pending] 2. Drive the app',
        '- [in_progress] 3. Own review',
        'Finish each, or rewrite its text as `skip: <reason>` and mark it completed, then stop.',
      ].join('\n'),
    })
    expect(await stop(FLOW, true)).toEqual({ type: 'none' })
    expect(todoRecords()).toEqual(['gate-block', 'gate-unresolved'])
  })

  it('lists at most five items', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ text: `step ${index}`, status: 'pending' as const }))
    const outcome = await stop(many)
    expect(outcome.type === 'block' && outcome.reason.split('\n')).toEqual([
      'jig/todos: 8 todo item(s) still open:',
      '- [pending] step 0',
      '- [pending] step 1',
      '- [pending] step 2',
      '- [pending] step 3',
      '- [pending] step 4',
      '- … and 3 more',
      'Finish each, or rewrite its text as `skip: <reason>` and mark it completed, then stop.',
    ])
  })

  it('passes when every item is completed or skipped, and without a todo list', async () => {
    const closed = FLOW.map((todo) => (todo.text.startsWith('2.') || todo.text.startsWith('3.') ? { ...todo, status: 'completed' as const } : todo))
    expect(await stop(closed)).toEqual({ type: 'none' })
    expect(await stop([])).toEqual({ type: 'none' })
    expect(await stop(undefined)).toEqual({ type: 'none' })
    expect(todoRecords()).toEqual([])
  })

  it('blocks again when the open set changes, and gives up after three blocks in a turn', async () => {
    const outcomes: string[] = []
    for (const open of ['a', 'b', 'c', 'd']) {
      outcomes.push((await stop([{ text: open, status: 'pending' }], outcomes.length > 0)).type)
    }
    expect(outcomes).toEqual(['block', 'block', 'block', 'none'])
    expect(todoRecords()).toEqual(['gate-block', 'gate-block', 'gate-block', 'gate-giveup'])
  })

  it('does not block a later turn on an open set the user already saw', async () => {
    await stop(FLOW)
    await stop(FLOW, true)
    await prompt()
    expect(await stop(FLOW)).toEqual({ type: 'none' })
    expect((await stop([...FLOW, { text: '6. New step', status: 'pending' }])).type).toBe('block')
  })

  it('blocks a /jig turn that has no todo list once, and never a plain turn', async () => {
    expect(await stop([])).toEqual({ type: 'none' })
    await dispatch({ kind: 'prompt', command: 'jig' }, base, pluginRoot)
    const first = await stop([])
    expect(first.type === 'block' && first.reason.split('\n')[0]).toBe('jig/todos: this /jig task has no todo list.')
    expect(await stop([], true)).toEqual({ type: 'none' })
    await prompt()
    expect(await stop([])).toEqual({ type: 'none' })
    await dispatch({ kind: 'prompt', command: 'jig:jig' }, base, pluginRoot)
    expect((await stop([])).type).toBe('block')
    expect(await stop(undefined)).toEqual({ type: 'none' })
  })

  it('passes with the rule off', async () => {
    write('.jig/config.jsonc', '{ "rules": { "jig/todos": "off" } }\n')
    expect(await stop(FLOW)).toEqual({ type: 'none' })
  })

  it('reads the todo list from the Claude Code hook input', async () => {
    const raw = JSON.stringify({ session_id: 'todos', cwd: root, transcript_path: join(FIXTURES, 'tasks.jsonl'), stop_hook_active: false })
    const hookEnv = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: join(root, 'no-config') }
    const output = JSON.parse(await handleHook('stop', raw, hookEnv)) as { decision: string; reason: string }
    expect(output.decision).toBe('block')
    expect(output.reason).toContain('- [pending] 3. Own review\n- [in_progress] 4. Pre-MR')
  })
})
