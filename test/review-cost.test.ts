import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICES,
  dollarsOf,
  formatReport,
  groupByLatestRunner,
  isoWeek,
  mrOf,
  readAgents,
  readTranscript,
  recordRuns,
  resolveSessionDir,
  roleOf,
  type CostRecord,
} from '../src/review/cost'

const dirs: string[] = []

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'jig-cost-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

const line = (id: string, model: string, usage: object, timestamp = '2026-10-22T08:00:00Z'): string =>
  JSON.stringify({ timestamp, message: { id, model, usage } })

const writeAgent = (sessionDir: string, id: string, description: string, lines: string[]): void => {
  const subagents = join(sessionDir, 'subagents')
  mkdirSync(subagents, { recursive: true })
  writeFileSync(join(subagents, `agent-${id}.jsonl`), `${lines.join('\n')}\n`)
  writeFileSync(join(subagents, `agent-${id}.meta.json`), JSON.stringify({ description }))
}

describe('readTranscript', () => {
  it('counts a message id once even when streaming repeats it per content block', () => {
    const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 } }
    const text = [line('m1', 'claude-sonnet-5-5', usage), line('m1', 'claude-sonnet-5-5', usage), line('m2', 'claude-sonnet-5-5', usage), 'not json'].join('\n')
    const result = readTranscript(text)
    expect(result.turns).toBe(2)
    expect(result.usage).toEqual({ input: 20, write5m: 0, write1h: 100, read: 2000, output: 200 })
    expect(result.model).toBe('claude-sonnet-5-5')
  })

  it('treats an unsplit cache creation count as a 5-minute write', () => {
    const result = readTranscript(line('m1', 'claude-opus-5-5', { cache_creation_input_tokens: 40 }))
    expect(result.usage.write5m).toBe(40)
    expect(result.usage.write1h).toBe(0)
  })
})

describe('dollarsOf', () => {
  it('prices cache writes and reads by their multipliers', () => {
    const usage = { input: 1e6, write5m: 1e6, write1h: 1e6, read: 1e6, output: 1e6 }
    expect(dollarsOf(usage, DEFAULT_PRICES['sonnet'])).toBeCloseTo(3 * (1 + 1.25 + 2 + 0.1) + 15)
    expect(dollarsOf(usage, undefined)).toBe(0)
  })
})

describe('roles and merge requests from descriptions', () => {
  it.each([
    ['Review MR !12', 'runner', '12'],
    ['Finder bugs-1 MR454', 'finder', '454'],
    ['Judge Important candidate MR452', 'judge', '452'],
    ['Deepener MR452', 'deepener', '452'],
    ['Outcome check MR452 threads', 'outcome', '452'],
    ['Post MR !13 results', 'poster', '13'],
    ['AFK: implement jig issue #5', 'other', undefined],
  ])('%s', (description, role, mr) => {
    expect(roleOf(description)).toBe(role)
    expect(mrOf(description)).toBe(mr)
  })
})

describe('groupByLatestRunner', () => {
  it('splits two passes over one merge request by their runners and sums dollars by role', () => {
    const session = tempDir()
    const usage = { output_tokens: 1e6 }
    writeAgent(session, 'r1', 'Review MR !7', [line('a', 'claude-opus-5-5', usage, '2026-10-22T08:00:00Z')])
    writeAgent(session, 'f1', 'Finder bugs-1 MR7', [line('b', 'claude-sonnet-5-5', usage, '2026-10-22T08:01:00Z')])
    writeAgent(session, 'r2', 'Review MR !7', [line('c', 'claude-opus-5-5', usage, '2026-10-22T11:00:00Z')])
    writeAgent(session, 'p2', 'Post MR !7 results', [line('d', 'claude-opus-5-5', usage, '2026-10-22T11:30:00Z')])
    const groups = groupByLatestRunner(readAgents(session, DEFAULT_PRICES))
    expect(groups.map((group) => [group.runner, group.dollars, group.byRole])).toEqual([
      ['r1', 40, { runner: 25, finder: 15 }],
      ['r2', 50, { runner: 25, poster: 25 }],
    ])
  })
})

describe('resolveSessionDir', () => {
  it('finds a session id under any project and defaults to the latest session of the project', () => {
    const projects = tempDir()
    const slug = join(projects, 'C--work-app')
    mkdirSync(join(slug, 's1', 'subagents'), { recursive: true })
    expect(resolveSessionDir('s1', 'C:/work/app', projects)).toBe(join(slug, 's1'))
    expect(resolveSessionDir(undefined, 'C:/work/app', projects)).toBe(join(slug, 's1'))
    expect(() => resolveSessionDir('missing', 'C:/work/app', projects)).toThrow(/not found/)
  })
})

describe('cost log', () => {
  const record = (overrides: Partial<CostRecord>): CostRecord => ({
    date: '2026-10-22',
    project: 'team/app',
    session: 's',
    mr: '1',
    runner: 'r',
    rerun: false,
    lines: { code: 800, tests: 150, docs: 50 },
    threads: 4,
    dollars: 10,
    byRole: { runner: 10 },
    cacheHit: 0.9,
    ...overrides,
  })

  it('appends each runner once', () => {
    const path = join(tempDir(), 'cost.jsonl')
    expect(recordRuns(path, [record({ runner: 'a' }), record({ runner: 'b' })])).toBe(2)
    expect(recordRuns(path, [record({ runner: 'a' }), record({ runner: 'c' })])).toBe(1)
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('reports $ per 1000 lines over all runs and $ per thread over first runs only', () => {
    const text = formatReport([record({}), record({ runner: 'r2', rerun: true, dollars: 6, threads: 9 })], 'project')
    expect(text).toBe('team/app: runs 2 (re-reviews 1) · $16.00 · $/1k lines $8.00 · $/thread (first runs) $2.50')
  })

  it('groups by ISO week', () => {
    expect(isoWeek('2026-10-22')).toBe('2026-W43')
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
    expect(formatReport([record({})], 'week')).toMatch(/^team\/app 2026-W43:/)
  })
})
