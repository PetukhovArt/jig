import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalRecord } from '../src/core/journal'
import { runLoop } from '../src/loop/loop'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

let projectRoot: string
let clock: number

const record = (fields: Partial<JournalRecord> & Pick<JournalRecord, 'kind'>): JournalRecord => ({
  v: 1,
  ts: new Date((clock += 1000)).toISOString(),
  session: 's1',
  agent: 'main',
  ...fields,
})

const stop = (): JournalRecord => record({ kind: 'gate-pass' })

const writeJournal = (records: JournalRecord[]): void => {
  const dir = join(projectRoot, '.jig', 'journal')
  mkdirSync(dir, { recursive: true })
  for (const entry of records) {
    writeFileSync(join(dir, `${entry.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(entry)}\n`, { flag: 'a' })
  }
}

const loop = (records: JournalRecord[], args: string[] = []): string => {
  writeJournal(records)
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  expect(runLoop(args)).toBe(0)
  const path = String(write.mock.calls[0]?.[0]).trim()
  write.mockRestore()
  return readFileSync(path, 'utf8')
}

const rows = (text: string): string[][] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Signal') && !line.startsWith('| ---'))
    .map((line) => line.split(' | ').map((cell) => cell.replace(/^\| | \|$/g, '')))

const signals = (records: JournalRecord[]): string[] => rows(loop(records)).map(([kind, rule, count]) => `${kind} ${rule} ${count}`)

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'jig-loop-'))
  vi.stubEnv('CLAUDE_PROJECT_DIR', projectRoot)
  clock = Date.now() - HOUR_MS
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('jig loop', () => {
  it('ignores deny and finding repeated within one turn', () => {
    const deny = { kind: 'deny', rule: 'jig/comments', file: 'src/a.ts' } as const
    const finding = { kind: 'finding', rule: 'no-unused-vars', file: 'src/b.ts' } as const
    expect(signals([record(deny), record(deny), record(finding), record(finding), stop()])).toEqual([])
  })

  it('takes deny and finding repeated in two turns', () => {
    const deny = { kind: 'deny', rule: 'jig/comments', file: 'src/a.ts' } as const
    const finding = { kind: 'finding', rule: 'no-unused-vars', file: 'src/b.ts' } as const
    const records = [record(deny), stop(), record(deny), record({ ...finding, session: 's2' }), record(finding)]
    expect(signals(records)).toEqual(['deny jig/comments 2', 'finding no-unused-vars 2'])
  })

  it('counts a subagent turn apart from the main agent turn', () => {
    const deny = { kind: 'deny', rule: 'jig/protected-paths', file: '.husky/pre-commit' } as const
    expect(signals([record(deny), record({ ...deny, agent: 'agent-7' })])).toEqual(['deny jig/protected-paths 2'])
  })

  it('takes failures and gate give-ups from a single record', () => {
    const records = [
      record({ kind: 'gate-giveup', rule: 'gate/tsc' }),
      record({ kind: 'gate-unresolved', rule: 'gate/eslint' }),
      record({ kind: 'hook-failure', rule: 'post-edit' }),
      record({ kind: 'tool-failure', rule: 'gate/oxlint' }),
    ]
    expect(signals(records).sort()).toEqual([
      'gate-giveup gate/tsc 1',
      'gate-unresolved gate/eslint 1',
      'hook-failure post-edit 1',
      'tool-failure gate/oxlint 1',
    ])
  })

  it('needs two records of the same rule and file for other kinds', () => {
    const records = [
      record({ kind: 'gate-block', rule: 'gate/tsc', file: 'src/a.ts' }),
      record({ kind: 'gate-block', rule: 'gate/tsc', file: 'src/b.ts' }),
      record({ kind: 'skip-verify' }),
      record({ kind: 'skip-verify' }),
    ]
    expect(signals(records)).toEqual(['skip-verify  2'])
  })

  it('lists at most three examples with file:line, oldest first', () => {
    const deny = { kind: 'deny', rule: 'jig/comments', file: 'src/a.ts' } as const
    const records = [1, 2, 3, 4].flatMap((line) => [record({ ...deny, line }), stop()])
    const [row] = rows(loop(records.reverse()))
    expect(row?.[2]).toBe('4')
    expect(row?.[3]?.match(/`src\/a\.ts:\d`/g)).toEqual(['`src/a.ts:1`', '`src/a.ts:2`', '`src/a.ts:3`'])
  })

  it('reads only the --days window', () => {
    const now = Date.now()
    const old = record({ kind: 'tool-failure', rule: 'gate/old', ts: new Date(now - 10 * DAY_MS).toISOString() })
    const recent = record({ kind: 'tool-failure', rule: 'gate/oxlint' })
    expect(signals([old, recent])).toEqual(['tool-failure gate/oxlint 1'])
    expect(rows(loop([], ['--days', '14'])).map(([, rule]) => rule).sort()).toEqual(['gate/old', 'gate/oxlint'])
  })
})
