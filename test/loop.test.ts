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
  turn: 1,
  ...fields,
})

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

const tableRows = (text: string, section: string): string[][] =>
  (text.split(`## ${section}\n`)[1] ?? '')
    .split('\n## ')[0]!
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| ---'))
    .slice(1)
    .map((line) => line.split(' | ').map((cell) => cell.replace(/^\| | \|$/g, '')))

const rows = (text: string): string[][] => tableRows(text, 'Candidates')

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
  it('ignores deny, finding and gate-block repeated within one turn', () => {
    const deny = { kind: 'deny', rule: 'jig/comments', file: 'src/a.ts' } as const
    const finding = { kind: 'finding', rule: 'no-unused-vars', file: 'src/b.ts' } as const
    const block = { kind: 'gate-block', rule: 'gate/tsc', file: 'src/c.ts' } as const
    expect(signals([deny, deny, finding, finding, block, block].map((fields) => record(fields)))).toEqual([])
  })

  it('takes deny, finding and gate-block repeated in two turns', () => {
    const deny = { kind: 'deny', rule: 'jig/comments', file: 'src/a.ts' } as const
    const finding = { kind: 'finding', rule: 'no-unused-vars', file: 'src/b.ts' } as const
    const block = { kind: 'gate-block', rule: 'gate/tsc', file: 'src/c.ts' } as const
    const records = [
      record(deny),
      record({ ...deny, turn: 2 }),
      record(finding),
      record({ ...finding, session: 's2' }),
      record(block),
      record({ ...block, turn: 3 }),
    ]
    expect(signals(records)).toEqual(['deny jig/comments 2', 'finding no-unused-vars 2', 'gate-block gate/tsc 2'])
  })

  it('counts a subagent record in the same turn as that turn', () => {
    const deny = { kind: 'deny', rule: 'jig/protected-paths', file: '.husky/pre-commit' } as const
    expect(signals([record(deny), record({ ...deny, agent: 'agent-7' })])).toEqual([])
  })

  it('treats each record without a turn as its own turn', () => {
    const { turn: _turn, ...deny } = record({ kind: 'deny', rule: 'jig/comments', file: 'src/a.ts' })
    expect(signals([deny, { ...deny }])).toEqual(['deny jig/comments 2'])
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

  it('keeps kinds that are not problem signals out of candidates and in the counts', () => {
    const kinds = ['gate-pass', 'gate-skipped', 'atom', 'no-verify-allowed', 'skip-verify'] as const
    const records = kinds.flatMap((kind) => [1, 2].map((turn) => record({ kind, rule: 'r', turn })))
    const text = loop(records)
    expect(rows(text)).toEqual([])
    expect(tableRows(text, 'Counts')).toEqual([
      ['atom', '2'],
      ['gate-pass', '2'],
      ['gate-skipped', '2'],
      ['no-verify-allowed', '2'],
      ['skip-verify', '2'],
    ])
  })

  it('lists at most three examples with file:line, oldest first', () => {
    const deny = { kind: 'deny', rule: 'jig/comments', file: 'src/a.ts' } as const
    const records = [1, 2, 3, 4].map((line) => record({ ...deny, line, turn: line }))
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
