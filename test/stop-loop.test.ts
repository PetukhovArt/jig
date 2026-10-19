import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { dispatch, type EventBase, type JigEvent } from '../src/hook/dispatch'

const pluginRoot = resolve(__dirname, '..')

vi.mock('../src/tools', () => ({
  TOOLS: [
    {
      name: 'probe',
      rule: 'gate/probe',
      binaries: [],
      stop: async (_tools: unknown, input: { files: readonly string[] }) => ({
        runs: [],
        findings: input.files.map((file) => ({ tool: 'probe', rule: 'probe/always', severity: 'error', file, line: 1, message: 'probe fails' })),
      }),
    },
  ],
}))

let root: string
let base: EventBase

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const send = (event: JigEvent) => dispatch(event, base, pluginRoot)

const editView = async (text: string) => {
  write('src/App.vue', text)
  await send({ kind: 'post-edit', file: 'src/App.vue' })
}

const journalKinds = (): string[] => readJournal(root).map((record) => record.kind)

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'jig-stop-loop-'))
  base = { sessionId: 'loop', projectRoot: root, cwd: root }
  git(['init', '-q'], root)
  write('src/a.ts', 'export const a = 1\n')
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
  await send({ kind: 'session-start', source: 'startup' })
  await send({ kind: 'prompt' })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('stop gate loop protection', () => {
  it('does not block again when the stop hook is active and nothing changed since the block', async () => {
    await editView('<template>a</template>\n')
    const first = await send({ kind: 'stop', stopHookActive: false })
    expect(first.type).toBe('block')
    expect(first.type === 'block' && first.reason).toContain('probe fails')
    expect(await send({ kind: 'stop', stopHookActive: true })).toEqual({ type: 'none' })
    expect(journalKinds()).toContain('gate-unresolved')
  })

  it('gives up on the fourth block in a row with the same findings', async () => {
    const outcomes: string[] = []
    for (const body of ['one', 'two', 'three', 'four']) {
      await editView(`<template>${body}</template>\n`)
      outcomes.push((await send({ kind: 'stop', stopHookActive: outcomes.length > 0 })).type)
    }
    expect(outcomes).toEqual(['block', 'block', 'block', 'none'])
    expect(journalKinds().filter((kind) => kind === 'gate-giveup')).toHaveLength(1)
  })
})
