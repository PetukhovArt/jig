import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { loadPlan } from '../src/core/plan'
import { turnDiff } from '../src/core/snapshot'
import { dispatch, type EventBase, type JigEvent } from '../src/hook/dispatch'
import { runStopChecks, stopSummary } from '../src/gates/stop'

const pluginRoot = resolve(__dirname, '..')
const budgets: number[] = []

vi.mock('../src/catalog/tools', () => ({
  DIRECTIVE_SOURCES: [],
  TOOLS: [
    {
      name: 'slow',
      rule: 'gate/slow',
      binaries: [],
      files: ['**'],
      stop: async (_tools: unknown, input: { budget: (ownMs: number) => number }) => {
        const timeoutMs = input.budget(30_000)
        budgets.push(timeoutMs)
        return { runs: [{ tool: 'slow', findings: [], durationMs: timeoutMs, failure: `timeout after ${timeoutMs} ms` }], findings: [] }
      },
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

const journalKinds = (): string[] => readJournal(root).map((record) => record.kind)

beforeEach(async () => {
  budgets.length = 0
  root = mkdtempSync(join(tmpdir(), 'jig-stop-incomplete-'))
  base = { sessionId: 'incomplete', projectRoot: root, cwd: root }
  git(['init', '-q'], root)
  write('src/a.ts', 'export const a = 1\n')
  write('.jig/config.jsonc', '{ "slow": { "timeout": 90 } }\n')
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
  await send({ kind: 'session-start', source: 'startup' })
  await send({ kind: 'prompt' })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('a tool that did not finish', () => {
  it('gets the timeout from its config entry', async () => {
    write('src/a.ts', 'export const a = 2\n')
    await runStopChecks({ projectRoot: root, pluginRoot, plan: loadPlan(root, pluginRoot), diff: turnDiff(root, {}, []) })
    expect(budgets).toEqual([90_000])
  })

  it('blocks the turn once with an unknown result instead of passing it', async () => {
    write('src/a.ts', 'export const a = 2\n')
    await send({ kind: 'post-edit', file: 'src/a.ts' })
    const first = await send({ kind: 'stop', stopHookActive: false })
    expect(first.type === 'block' && first.reason).toContain('slow did not finish (timeout after 90000 ms)')
    expect(await send({ kind: 'stop', stopHookActive: true })).toEqual({ type: 'none' })
    expect(readJournal(root).filter((record) => record.kind === 'gate-block').map((record) => record.rule)).toEqual(['gate/incomplete'])
    expect(journalKinds()).not.toContain('gate-pass')
  })

  it('prints incomplete, not clean, from jig check stop', async () => {
    write('src/a.ts', 'export const a = 2\n')
    const checks = await runStopChecks({ projectRoot: root, pluginRoot, plan: loadPlan(root, pluginRoot), diff: turnDiff(root, {}, []) })
    expect(stopSummary(checks, pluginRoot)).toEqual({ text: 'incomplete: slow did not finish (timeout after 90000 ms)', code: 3 })
  })
})
