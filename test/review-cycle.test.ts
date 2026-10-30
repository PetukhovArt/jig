import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adapterCommand, nativePath, parseQueue } from '../src/review-cycle/adapter'
import type { Exec, ExecResult } from '../src/review-cycle/exec'
import { legacyStateKey } from '../src/review-cycle/import-state'
import { runReviewCycleWith } from '../src/review-cycle/review-cycle'
import { reviewStateKey, reviewStatePath } from '../src/review-cycle/state'

const ME = 7
const DEV = 9
const REMOTE = 'https://gitlab.example.com/team/app.git'
const URL = (iid: number): string => `https://gitlab.example.com/team/app/-/merge_requests/${iid}`

interface NoteFixture {
  author: number
  at: string
  body?: string
  open?: boolean
  system?: boolean
}

const note = ({ author, at, body = 'text', open, system = false }: NoteFixture): Record<string, unknown> => ({
  id: Math.floor(Math.random() * 1e9),
  author: { id: author },
  system,
  resolvable: open !== undefined,
  resolved: open === false,
  created_at: at,
  body,
})

const thread = (id: string, ...notes: NoteFixture[]): Record<string, unknown> => ({ id, notes: notes.map(note) })

interface MrFixture {
  sha?: string
  target?: string
  commits?: string[]
  discussions?: Record<string, unknown>[]
  approvedBy?: number[]
}

interface World {
  mrs: Record<number, MrFixture>
  reviewerQueue?: Record<string, unknown>[]
  adapter?: Partial<Record<string, ExecResult>>
  glabDown?: boolean
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' })

let root: string
let adapterPath: string
let calls: string[][]

const glab = (world: World, args: readonly string[]): ExecResult => {
  if (world.glabDown) return { code: 1, stdout: '', stderr: 'connection refused' }
  const path = args[1] ?? ''
  if (path === 'user') return ok(JSON.stringify({ id: ME }))
  if (path.startsWith('projects/:fullpath/merge_requests?')) return ok(JSON.stringify(world.reviewerQueue ?? []))
  const match = /merge_requests\/(\d+)(\/[a-z]+)?/.exec(path)
  const mr = world.mrs[Number(match?.[1])]
  if (mr === undefined) return { code: 1, stdout: '{"message":"404 Not Found"}', stderr: '' }
  switch (match?.[2]) {
    case undefined:
      return ok(JSON.stringify({ sha: mr.sha ?? 'head', target_branch: mr.target ?? 'main' }))
    case '/approvals':
      return ok(JSON.stringify({ approved_by: (mr.approvedBy ?? []).map((id) => ({ user: { id } })) }))
    case '/commits': {
      const [first, ...rest] = (mr.commits ?? []).map((at) => [{ created_at: at }])
      return ok([JSON.stringify(first ?? []), ...rest.map((page) => JSON.stringify(page))].join(''))
    }
    case '/discussions':
      return ok(JSON.stringify(mr.discussions ?? []))
    default:
      return { code: 1, stdout: '', stderr: `unexpected ${path}` }
  }
}

const fakeExec =
  (world: World): Exec =>
  (command, args) => {
    calls.push([command, ...args])
    if (command === 'glab') return glab(world, args)
    if (args[0] === adapterPath) return world.adapter?.[args.slice(1).join(' ')] ?? world.adapter?.[args[1] ?? ''] ?? ok('')
    return { code: null, stdout: '', stderr: '', error: `unexpected command ${command}` }
  }

const run = (world: World, args: string[]): { code: number; out: string[] } => {
  const out: string[] = []
  const code = runReviewCycleWith(args, { exec: fakeExec(world), cwd: root, print: (line) => out.push(line) })
  return { code, out }
}

const row = (iid: number, extra: { draft?: boolean; approved?: boolean; refs?: string; repoDir?: string } = {}): string =>
  ['ROW', extra.refs ?? `!${iid}`, extra.repoDir ?? root, iid, `feature-${iid}`, extra.draft ?? false, extra.approved ? 'APPROVED' : 'pending', URL(iid)].join('\t')

const adapterQueue = (rows: string[], stale: 'on' | 'off' = 'on'): Partial<Record<string, ExecResult>> => ({
  queue: ok(`${rows.join('\n')}\n`),
  rules: ok(`stale=${stale}\n`),
})

const queueLines = (world: World): string[] => {
  const result = run(world, ['queue', '--adapter', adapterPath])
  expect(result.code).toBe(0)
  return result.out.filter((line) => /^(ACTIONABLE|SKIP|BLOCKED)\t/.test(line))
}

const decisionOf = (line: string | undefined): string => {
  const [kind, reason] = (line ?? '').split('\t')
  return kind === 'SKIP' ? `SKIP ${reason}` : (kind ?? '')
}

const writeState = (iid: number, state: Record<string, unknown>): string => {
  const path = reviewStatePath(root, REMOTE, String(iid))
  mkdirSync(join(root, '.jig', 'runs', 'review'), { recursive: true })
  writeFileSync(path, JSON.stringify(state))
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-review-cycle-'))
  spawnSync('git', ['init', '-q', root])
  spawnSync('git', ['remote', 'add', 'origin', REMOTE], { cwd: root })
  adapterPath = join(root, 'adapter.mjs')
  writeFileSync(adapterPath, '')
  calls = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const MY_OPEN_THREAD = thread('d1', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🔴 Important]** bug', open: true })

describe('jig review-cycle queue: filter rules', () => {
  it('skips a merge request approved by anyone, from the adapter row or from the forge', () => {
    expect(queueLines({ mrs: { 1: {} }, adapter: adapterQueue([row(1, { approved: true })]) }).map(decisionOf)).toEqual(['SKIP approved'])
    const forgeQueue = { mrs: { 2: { approvedBy: [DEV] } }, reviewerQueue: [{ iid: 2, source_branch: 'b', draft: false, web_url: URL(2) }] }
    const result = run(forgeQueue, ['queue'])
    expect(result.out.filter((line) => line.startsWith('SKIP')).map(decisionOf)).toEqual(['SKIP approved'])
  })

  it('warns on the first line when no adapter is configured, and not with one', () => {
    expect(run({ mrs: {}, reviewerQueue: [] }, ['queue']).out[0]).toMatch(/^WARNING\tbuilt-in adapter: .*no tracker spec, verdicts not recorded/)
    expect(run({ mrs: {}, adapter: adapterQueue([]) }, ['queue', '--adapter', adapterPath]).out[0]).toBe(`adapter: ${adapterPath}`)
  })

  it('skips a draft', () => {
    expect(queueLines({ mrs: { 1: {} }, adapter: adapterQueue([row(1, { draft: true })]) }).map(decisionOf)).toEqual(['SKIP draft'])
  })

  it('skips a stale re-review only when the adapter says stale=on', () => {
    const mrs = { 1: { commits: ['2026-10-09T10:00:00Z'], discussions: [MY_OPEN_THREAD] } }
    expect(queueLines({ mrs, adapter: adapterQueue([row(1)], 'on') }).map(decisionOf)).toEqual(['SKIP stale'])
    expect(queueLines({ mrs, adapter: adapterQueue([row(1)], 'off') }).map(decisionOf)).toEqual(['ACTIONABLE'])
  })

  it('does not call a re-review stale when a commit landed after my last note, or when my only open thread is a Nit', () => {
    const newerCommit = { commits: ['2026-10-11T10:00:00Z'], discussions: [MY_OPEN_THREAD] }
    const nitOnly = {
      commits: ['2026-10-09T10:00:00Z'],
      discussions: [thread('d2', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🟡 Nit]** name', open: true })],
    }
    expect(queueLines({ mrs: { 1: newerCommit, 2: nitOnly }, adapter: adapterQueue([row(1), row(2)]) }).map(decisionOf)).toEqual([
      'ACTIONABLE',
      'ACTIONABLE',
    ])
  })

  it('skips an unchanged head, unless a developer answered in my open thread after my last note', () => {
    writeState(1, { last_reviewed_sha: 'abc', findings: [] })
    writeState(2, { last_reviewed_sha: 'abc', findings: [] })
    const answered = thread(
      'd3',
      { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🔴 Important]** bug', open: true },
      { author: DEV, at: '2026-10-10T12:00:00Z', body: 'fixed', open: true },
    )
    const mrs = { 1: { sha: 'abc', discussions: [] }, 2: { sha: 'abc', discussions: [answered] } }
    expect(queueLines({ mrs, adapter: adapterQueue([row(1), row(2)]) }).map(decisionOf)).toEqual(['SKIP unchanged', 'ACTIONABLE'])
  })

  it('skips a rebased head whose diff hashes to the state diff_hash, and reviews one whose diff moved', () => {
    const upstream = mkdtempSync(join(tmpdir(), 'jig-review-cycle-upstream-'))
    try {
      const sh = (...args: string[]): string => spawnSync('git', args, { cwd: upstream, encoding: 'utf8' }).stdout.trim()
      const commit = (file: string): string => {
        writeFileSync(join(upstream, file), `${file}\n`)
        sh('add', file)
        sh('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file)
        return sh('rev-parse', 'HEAD')
      }
      sh('init', '-q', '-b', 'main')
      commit('base.txt')
      sh('checkout', '-q', '-b', 'feature-1')
      const reviewed = commit('feature.txt')
      const patch = spawnSync('git', ['diff', '--no-color', '--no-ext-diff', 'main...feature-1'], { cwd: upstream, encoding: 'utf8' }).stdout
      const hash = spawnSync('git', ['hash-object', '--stdin'], { cwd: upstream, input: patch, encoding: 'utf8' }).stdout.trim()
      sh('checkout', '-q', 'main')
      commit('other.txt')
      sh('checkout', '-q', '-b', 'rebased', 'main')
      const rebased = commit('feature.txt')
      const moved = commit('more.txt')
      spawnSync('git', ['remote', 'set-url', 'origin', upstream], { cwd: root })
      mkdirSync(join(root, '.jig', 'runs', 'review'), { recursive: true })
      for (const iid of [1, 2]) writeFileSync(reviewStatePath(root, upstream, String(iid)), JSON.stringify({ last_reviewed_sha: reviewed, diff_hash: hash, findings: [] }))
      const mrs = { 1: { sha: rebased, target: 'main' }, 2: { sha: moved, target: 'main' } }
      expect(queueLines({ mrs, adapter: adapterQueue([row(1), row(2)]) }).map(decisionOf)).toEqual(['SKIP unchanged', 'ACTIONABLE'])
    } finally {
      rmSync(upstream, { recursive: true, force: true })
    }
  })

  it('reviews a head the state has not seen and reports the standing findings of its state', () => {
    writeState(1, {
      last_reviewed_sha: 'old',
      findings: [
        { id: 'a', status: 'open' },
        { id: 'b', status: 'skipped' },
        { id: 'c', status: 'fixed' },
        { id: 'd', status: 'optional' },
      ],
    })
    const [line] = queueLines({ mrs: { 1: { sha: 'new' } }, adapter: adapterQueue([row(1)]) })
    expect(decisionOf(line)).toBe('ACTIONABLE')
    expect(line).toContain('standing=2')
  })

  it('skips a merge request whose review worktree is live', () => {
    mkdirSync(join(root, '..', `${root.split(/[\\/]/).pop() ?? ''}-review-1`), { recursive: true })
    try {
      expect(queueLines({ mrs: { 1: {} }, adapter: adapterQueue([row(1)]) }).map(decisionOf)).toEqual(['SKIP busy'])
    } finally {
      rmSync(join(root, '..', `${root.split(/[\\/]/).pop() ?? ''}-review-1`), { recursive: true, force: true })
    }
  })

  it('does not call a re-review stale when the developer answered my open thread without a commit', () => {
    const answered = thread(
      'd1',
      { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🔴 Important]** bug', open: true },
      { author: DEV, at: '2026-10-10T12:00:00Z', body: 'not a bug: see the guard', open: true },
    )
    const mrs = { 1: { commits: ['2026-10-09T10:00:00Z'], discussions: [answered] } }
    expect(queueLines({ mrs, adapter: adapterQueue([row(1)], 'on') }).map(decisionOf)).toEqual(['ACTIONABLE'])
  })

  it('reviews again when the developer answered my FYI note, and not when my note there is last', () => {
    const fyi = (...notes: NoteFixture[]): Record<string, unknown> =>
      thread('fyi', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🟡 Nit] Improvements**\n- [ ] a.ts\n<!-- review-fyi -->' }, ...notes)
    writeState(1, { last_reviewed_sha: 'abc', findings: [] })
    writeState(2, { last_reviewed_sha: 'abc', findings: [] })
    const mrs = {
      1: { sha: 'abc', discussions: [fyi({ author: DEV, at: '2026-10-11T10:00:00Z', body: 'done all three' })] },
      2: {
        sha: 'abc',
        discussions: [fyi({ author: DEV, at: '2026-10-11T10:00:00Z', body: 'done' }, { author: ME, at: '2026-10-11T12:00:00Z', body: 'ticked 3' })],
      },
    }
    expect(queueLines({ mrs, adapter: adapterQueue([row(1), row(2)]) }).map(decisionOf)).toEqual(['ACTIONABLE', 'SKIP unchanged'])
  })

  it('aborts with exit 3 when the adapter queue cannot answer, and blocks one merge request when its forge call fails', () => {
    const down = run({ mrs: {}, adapter: { queue: { code: 3, stdout: '', stderr: 'ERROR projects/x' } } }, ['queue', '--adapter', adapterPath])
    expect(down.code).toBe(3)
    const lines = queueLines({ mrs: {}, adapter: adapterQueue([row(5)]) })
    expect(lines.map(decisionOf)).toEqual(['BLOCKED'])
  })

  it('blocks a merge request whose refs the adapter blocks (exit 4 on rules)', () => {
    const adapter = { queue: ok(`${row(1)}\n`), rules: { code: 4, stdout: '', stderr: 'ref parked on a human' } }
    const [line] = queueLines({ mrs: { 1: {} }, adapter })
    expect(line).toMatch(/^BLOCKED\t.*ref parked on a human$/)
  })
})

const outcomeOf = (line: string | undefined): string | undefined => /\toutcome=(\w+)/.exec(line ?? '')?.[1]

const finding = (id: string, severity: string, status: string, discussion: string | null): Record<string, unknown> => ({
  id,
  severity,
  status,
  discussion_id: discussion,
})

describe('jig review-cycle queue: the outcome of a skipped merge request', () => {
  const myThread = (id: string, chip: string, open: boolean): Record<string, unknown> =>
    thread(id, { author: ME, at: '2026-10-10T10:00:00Z', body: `**[${chip}]** defect`, open })

  it('returns an unchanged merge request whose Important stands in an open thread, and holds the rest', () => {
    writeState(1, { last_reviewed_sha: 'abc', findings: [finding('a', 'Important', 'skipped', 'd1'), finding('b', 'Important', 'fixed', 'd2')] })
    writeState(2, { last_reviewed_sha: 'abc', findings: [finding('a', 'Nit', 'skipped', 'd1')] })
    writeState(3, { last_reviewed_sha: 'abc', findings: [finding('a', 'Important', 'skipped', 'd1')] })
    writeState(4, { last_reviewed_sha: 'abc', findings: [finding('a', 'Important', 'unverified', 'd1')] })
    writeState(5, { last_reviewed_sha: 'abc', findings: [finding('a', 'Important', 'open', 'd1')] })
    const important = [myThread('d1', '🔴 Important', true), myThread('d2', '🔴 Important', false)]
    const mrs = {
      1: { sha: 'abc', discussions: important },
      2: { sha: 'abc', discussions: [myThread('d1', '🟡 Nit', true)] },
      3: { sha: 'abc', discussions: [myThread('d1', '🔴 Important', false)] },
      4: { sha: 'abc', discussions: important },
      5: { sha: 'abc', discussions: important },
    }
    const lines = queueLines({ mrs, adapter: adapterQueue([1, 2, 3, 4, 5].map((iid) => row(iid))) })
    expect(lines.map(decisionOf)).toEqual(Array(5).fill('SKIP unchanged'))
    expect(lines.map(outcomeOf)).toEqual(['returned', 'held', 'held', 'held', 'returned'])
  })

  it('returns a stale merge request whose Important stands, holds a stale one without state', () => {
    writeState(1, { last_reviewed_sha: 'old', findings: [finding('a', 'Important', 'open', 'd1')] })
    const stale = { sha: 'new', commits: ['2026-10-09T10:00:00Z'], discussions: [MY_OPEN_THREAD] }
    const lines = queueLines({ mrs: { 1: stale, 2: stale }, adapter: adapterQueue([row(1), row(2)], 'on') })
    expect(lines.map(decisionOf)).toEqual(['SKIP stale', 'SKIP stale'])
    expect(lines.map(outcomeOf)).toEqual(['returned', 'held'])
  })

  it('gives approved its own outcome and holds a draft', () => {
    const lines = queueLines({ mrs: { 1: {}, 2: {} }, adapter: adapterQueue([row(1, { approved: true }), row(2, { draft: true })]) })
    expect(lines.map(outcomeOf)).toEqual(['approved', 'held'])
  })
})

describe('jig review-cycle standing', () => {
  it('counts Important findings left open or skipped whose thread is still open', () => {
    writeState(1, {
      last_reviewed_sha: 'abc',
      findings: [
        finding('a', 'Important', 'skipped', 'd1'),
        finding('b', 'Important', 'open', 'd2'),
        finding('c', 'Important', 'skipped', 'd3'),
        finding('d', 'Nit', 'skipped', 'd1'),
        finding('e', 'Important', 'unverified', 'd1'),
        finding('f', 'Important', 'open', null),
      ],
    })
    const discussions = [
      MY_OPEN_THREAD,
      thread('d2', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🔴 Important]** other', open: true }),
      thread('d3', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🔴 Important]** resolved', open: false }),
    ]
    expect(run({ mrs: { 1: { discussions } } }, ['standing', '1']).out).toEqual(['2'])
    expect(run({ mrs: { 2: { discussions } } }, ['standing', '2']).out).toEqual(['0'])
  })
})

describe('jig review-cycle unresolved', () => {
  it('counts open threads by anyone and ignores those opened with a Nit or Pre-existing chip', () => {
    const discussions = [
      MY_OPEN_THREAD,
      thread('d2', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🟡 Nit]** rename', open: true }),
      thread('d3', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🟣 Pre-existing]** old bug', open: true }),
      thread('d4', { author: DEV, at: '2026-10-10T10:00:00Z', body: 'question', open: true }),
      thread('d5', { author: ME, at: '2026-10-10T10:00:00Z', body: '**[🔴 Important]** fixed', open: false }),
      thread('d6', { author: ME, at: '2026-10-10T10:00:00Z', body: 'FYI note' }),
    ]
    expect(run({ mrs: { 1: { discussions } } }, ['unresolved', '1']).out).toEqual(['2'])
  })

  it('exits 3 when the forge cannot answer, never 0', () => {
    expect(run({ mrs: {}, glabDown: true }, ['unresolved', '1']).code).toBe(3)
  })
})

describe('jig review-cycle reconcile', () => {
  const before = (): string =>
    writeState(1, { last_reviewed_sha: 'x', findings: [{ id: 'a', status: 'open' }, { id: 'b', status: 'unverified' }, { id: 'c', status: 'fixed' }] })

  it('passes a tally that accounts for every standing finding', () => {
    const result = run({ mrs: {} }, ['reconcile', before(), '{"important":0,"prior_fixed":1,"prior_skipped":1}'])
    expect(result).toEqual({ code: 0, out: ['OK\tstanding=2\taccounted=2'] })
  })

  it('blocks a short tally', () => {
    const result = run({ mrs: {} }, ['reconcile', before(), '{"prior_fixed":1}'])
    expect(result.code).toBe(1)
    expect(result.out[0]).toBe('BLOCKED\ttally accounts for 1 of 2 standing findings')
  })

  it('blocks a degraded run, and on a first run asks to delete the state it wrote', () => {
    const tally = join(root, 'tally.json')
    writeFileSync(tally, '{"prior_fixed":0,"degraded":"spawn refused"}')
    const result = run({ mrs: {} }, ['reconcile', 'none', tally])
    expect(result.code).toBe(1)
    expect(result.out[0]).toBe('BLOCKED\tdegraded: spawn refused')
    expect(result.out[1]).toContain('delete the state file')
  })
})

describe('jig review-cycle verdict', () => {
  const transitions = (): string[] => calls.filter((call) => call[2] === 'transition').map((call) => call.slice(3).join(' '))

  it('folds outcomes per ref: any returned wins, all ready is ready, a held merge request keeps the ref where it is', () => {
    const result = run({ mrs: {}, adapter: {} }, [
      'verdict',
      '--adapter',
      adapterPath,
      'PROJ-1=ready',
      'PROJ-1,PROJ-2=returned',
      'PROJ-3=ready',
      'PROJ-4=ready',
      'PROJ-4=stale',
      'PROJ-5=approved',
    ])
    expect(result.code).toBe(0)
    expect(transitions()).toEqual(['PROJ-1 returned', 'PROJ-2 returned', 'PROJ-3 ready', 'PROJ-5 none'])
    expect(result.out).toContain('PROJ-4: no transition (an MR of it was skipped, blocked or still open)')
  })

  it('reports an adapter exit 4 as the ref reason and an exit 3 as a status not recorded, and goes on', () => {
    const adapter = {
      'transition PROJ-1 returned': { code: 4, stdout: '', stderr: 'no open MR, check by hand' },
      'transition PROJ-2 ready': { code: 3, stdout: '', stderr: 'ERROR tracker down' },
      'transition PROJ-3 ready': ok('PROJ-3 → Ready to merge\n'),
    }
    const result = run({ mrs: {}, adapter }, ['verdict', '--adapter', adapterPath, 'PROJ-1=returned', 'PROJ-2=ready', 'PROJ-3=ready'])
    expect(result.code).toBe(3)
    expect(result.out).toEqual(['PROJ-1: no open MR, check by hand', 'PROJ-2: status not recorded, adapter transition: tracker down', 'PROJ-3 → Ready to merge'])
  })
})

describe('jig review-cycle head', () => {
  it('compares the forge head with the reviewed sha of the state, not with the local HEAD', () => {
    const commit = (message: string): string => {
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', message], { cwd: root })
      return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
    }
    const reviewed = commit('reviewed')
    const pushed = [commit('fix 1'), commit('fix 2')].at(-1) ?? ''
    spawnSync('git', ['checkout', '-q', '--detach', reviewed], { cwd: root })
    writeState(1, { last_reviewed_sha: reviewed, findings: [] })
    expect(run({ mrs: { 1: { sha: reviewed } } }, ['head', '1'])).toEqual({ code: 0, out: [`UNCHANGED\t${reviewed}`] })
    expect(run({ mrs: { 1: { sha: pushed } } }, ['head', '1'])).toEqual({ code: 1, out: [`MOVED\t${reviewed}\t${pushed}\tcommits=2`] })
  })
})

describe('jig review-cycle spec-hold', () => {
  it('holds open unposted spec findings whose quote is not in the spec', () => {
    const state = writeState(1, {
      findings: [
        { id: 'quoted', status: 'open', category: 'spec', spec_quote: 'The button  is hidden\nfor guests.' },
        { id: 'invented', status: 'open', category: 'spec', spec_quote: 'Guests see nothing.' },
        { id: 'posted', status: 'open', category: 'spec', spec_quote: 'nope', discussion_id: 'd1' },
        { id: 'bug', status: 'open', category: 'correctness' },
      ],
    })
    const spec = join(root, 'spec.md')
    writeFileSync(spec, '# Task\nThe button is hidden for guests. Admins see it.\n')
    expect(run({ mrs: {} }, ['spec-hold', state, spec]).out).toEqual(['invented'])
  })
})

describe('Windows paths', () => {
  it('reads a Git Bash repo_dir from an adapter row as a Windows path on Windows only', () => {
    const line = ['ROW', '!1', '/c/Users/dev/app', '1', 'b', 'false', 'pending', URL(1)].join('\t')
    expect(parseQueue(line, 'win32').rows[0]?.repoDir).toBe('C:/Users/dev/app')
    expect(parseQueue(line, 'linux').rows[0]?.repoDir).toBe('/c/Users/dev/app')
    expect(nativePath('C:/Users/dev/app', 'win32')).toBe('C:/Users/dev/app')
  })

  it('runs a shell adapter with Git for Windows bash, not the bash of System32', () => {
    const git = join(root, 'Git')
    mkdirSync(join(git, 'cmd'), { recursive: true })
    mkdirSync(join(git, 'bin'), { recursive: true })
    writeFileSync(join(git, 'cmd', 'git.exe'), '')
    writeFileSync(join(git, 'bin', 'bash.exe'), '')
    const env = { PATH: join(git, 'cmd'), PATHEXT: '.EXE' }
    expect(adapterCommand('C:/repo/process.sh', env, 'win32')).toEqual([join(git, 'bin', 'bash.exe'), 'C:/repo/process.sh'])
    expect(adapterCommand('C:/repo/process.mjs', env, 'win32')).toEqual([process.execPath, 'C:/repo/process.mjs'])
  })
})

describe('jig review-cycle import-state', () => {
  let legacy: string

  const legacyPath = (iid: number, remote = REMOTE): string => join(legacy, `app-${legacyStateKey(remote, iid)}.json`)

  const legacyFile = (iid: number, state: Record<string, unknown>, remote = REMOTE): void => {
    writeFileSync(legacyPath(iid, remote), JSON.stringify({ remote, target: String(iid), ...state }))
  }

  const ignoreJig = (): void => writeFileSync(join(root, '.gitignore'), '.jig/\n')

  beforeEach(() => {
    legacy = join(root, 'legacy')
    mkdirSync(legacy)
  })

  it('copies a compatible state of this repository, converted, and the queue then skips the reviewed head', () => {
    ignoreJig()
    legacyFile(5, {
      key: 'old',
      last_reviewed_sha: 'abc',
      degraded: 'spawn refused',
      replies: [],
      tally: {},
      findings: [{ id: 'a', status: 'no_change_needed', withdrawn: true, discussion_id: null }],
    })
    legacyFile(6, { findings: [{ id: 'b', status: 'bogus' }] })
    legacyFile(7, { findings: [] }, 'https://gitlab.example.com/team/other.git')
    const result = run({ mrs: {} }, ['import-state', '--from', legacy])
    expect(result.code).toBe(0)
    expect(result.out[0]).toMatch(/^IMPORTED\t!5\t.*\tdropped findings\[\]\.withdrawn, replies$/)
    expect(result.out[1]).toMatch(/^SKIP\t!6\t.*no valid status$/)
    expect(result.out[2]).toMatch(/^import-state: 1 imported, 1 skipped, 1 of other repositories/)
    const imported = JSON.parse(readFileSync(reviewStatePath(root, REMOTE, '5'), 'utf8')) as Record<string, unknown>
    expect(imported).toMatchObject({ key: reviewStateKey(REMOTE, '5'), target: '5', tally: { degraded: 'spawn refused' } })
    expect(imported['findings']).toEqual([{ id: 'a', status: 'no_change_needed', discussion_id: null }])
    expect(existsSync(reviewStatePath(root, REMOTE, '6'))).toBe(false)
    expect(queueLines({ mrs: { 5: { sha: 'abc' } }, adapter: adapterQueue([row(5)]) }).map(decisionOf)).toEqual(['SKIP unchanged'])
  })

  it('finds the merge request by the file key when the target is a URL or names another one', () => {
    ignoreJig()
    writeFileSync(legacyPath(42), JSON.stringify({ remote: REMOTE, target: URL(42), findings: [] }))
    writeFileSync(legacyPath(43), JSON.stringify({ remote: REMOTE, target: '!999', findings: [] }))
    const out = run({ mrs: {} }, ['import-state', '--from', legacy]).out
    expect(out.slice(0, 2).map((line) => line.split('\t').slice(0, 2).join(' ')).sort()).toEqual(['IMPORTED !42', 'IMPORTED !43'])
  })

  it('never replaces a jig state that finished at the same time or later; an older one is backed up, then replaced', () => {
    ignoreJig()
    const newer = writeState(1, { last_reviewed_sha: 'jig', timings: { finished_at: '2026-10-19T10:00:00Z' }, findings: [] })
    const older = writeState(2, { last_reviewed_sha: 'jig', timings: { finished_at: '2026-10-01T10:00:00Z' }, findings: [] })
    legacyFile(1, { last_reviewed_sha: 'old', timings: { finished_at: '2026-10-10T10:00:00Z' }, findings: [] })
    legacyFile(2, { last_reviewed_sha: 'old', timings: { finished_at: '2026-10-10T10:00:00Z' }, findings: [] })
    const out = run({ mrs: {} }, ['import-state', '--from', legacy]).out
    expect(out[0]).toMatch(/^SKIP\t!1\t.*as new or newer$/)
    expect(out[1]).toMatch(/^IMPORTED\t!2\t/)
    expect(JSON.parse(readFileSync(newer, 'utf8'))).toMatchObject({ last_reviewed_sha: 'jig' })
    expect(JSON.parse(readFileSync(older, 'utf8'))).toMatchObject({ last_reviewed_sha: 'old' })
    expect(readdirSync(dirname(older)).filter((name) => name.includes('.bak-import-'))).toHaveLength(1)
    expect(run({ mrs: {} }, ['import-state', '--from', legacy]).out[1]).toMatch(/^SKIP\t!2\t.*already imported$/)
  })

  it('writes nothing where .jig/runs is not gitignored, and --dry-run writes nothing anywhere', () => {
    legacyFile(5, { findings: [] })
    expect(run({ mrs: {} }, ['import-state', '--from', legacy]).code).toBe(3)
    expect(run({ mrs: {} }, ['import-state', '--from', legacy, '--dry-run']).out[0]).toMatch(/^WOULD IMPORT\t!5\t/)
    expect(existsSync(join(root, '.jig'))).toBe(false)
  })
})
