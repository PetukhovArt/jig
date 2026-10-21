import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { openShellCalls } from '../src/core/state'
import { dispatch, type EventBase, type JigEvent } from '../src/hook/dispatch'

const pluginRoot = resolve(__dirname, '..')

vi.mock('../src/catalog/tools', () => ({
  DIRECTIVE_SOURCES: [],
  TOOLS: [
    {
      name: 'probe',
      rule: 'gate/probe',
      binaries: [],
      files: ['**'],
      stop: async (_tools: unknown, input: { files: readonly string[] }) => ({
        runs: [],
        findings: input.files.map((file) => ({ tool: 'probe', rule: 'probe/always', severity: 'error', file, line: 1, message: `probe fails ${file}` })),
      }),
    },
  ],
}))

let root: string

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const session = (sessionId: string, attributesShell = true): EventBase => ({ sessionId, projectRoot: root, cwd: root, attributesShell })

const send = (base: EventBase, event: JigEvent) => dispatch(event, base, pluginRoot)

const start = async (base: EventBase): Promise<void> => {
  await send(base, { kind: 'session-start', source: 'startup' })
  await send(base, { kind: 'prompt' })
}

const shell = async (base: EventBase, callId: string, body: () => void): Promise<void> => {
  await send(base, { kind: 'pre-shell', callId })
  body()
  await send(base, { kind: 'post-shell', callId, isBackground: false })
}

const stop = (base: EventBase) => send(base, { kind: 'stop', stopHookActive: false })

const journalOf = (sessionId: string) => readJournal(root).filter((record) => record.session === sessionId)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-shell-'))
  git(['init', '-q'], root)
  write('src/a.ts', 'export const a = 1\n')
  write('.jig/config.jsonc', '{ "probe": {} }\n')
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('shell attribution', () => {
  it('leaves a file another session wrote between the tool calls out of the gate and notes it', async () => {
    const a = session('a')
    const b = session('b')
    await start(a)
    await start(b)
    await shell(a, 'a1', () => undefined)
    write('src/a.ts', 'export const a = 2\n')
    await send(b, { kind: 'post-edit', file: 'src/a.ts' })
    await shell(a, 'a2', () => undefined)
    expect(await stop(a)).toEqual({ type: 'none' })
    const records = journalOf('a')
    expect(records.map((record) => record.kind)).toEqual(['foreign-change'])
    expect(records[0]?.message).toBe('src/a.ts')
    expect(await stop(b)).toMatchObject({ type: 'block' })
  })

  it('checks a file the session wrote through its own shell call', async () => {
    const a = session('a')
    await start(a)
    await shell(a, 'a1', () => write('src/x.ts', 'export const x = 1\n'))
    const outcome = await stop(a)
    expect(outcome.type === 'block' && outcome.reason).toContain('probe fails src/x.ts')
  })

  it('attributes a shell call with no post event at the stop and closes it', async () => {
    const a = session('a')
    await start(a)
    await send(a, { kind: 'pre-shell', callId: 'bg' })
    await send(a, { kind: 'post-shell', callId: 'bg', isBackground: true })
    write('src/gen.ts', 'export const g = 1\n')
    const outcome = await stop(a)
    expect(outcome.type === 'block' && outcome.reason).toContain('probe fails src/gen.ts')
    expect(openShellCalls(root, 'a')).toEqual([])
  })

  it('keeps the snapshot diff for an agent without shell events', async () => {
    const a = session('a', false)
    await start(a)
    write('src/a.ts', 'export const a = 3\n')
    const outcome = await stop(a)
    expect(outcome.type === 'block' && outcome.reason).toContain('probe fails src/a.ts')
    expect(journalOf('a').map((record) => record.kind)).not.toContain('foreign-change')
  })
})
