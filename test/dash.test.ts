import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeRunContext, runDash } from '../src/dash/dash'

vi.mock('../src/dash/template.html', async () => {
  const fs = await import('node:fs')
  return { default: fs.readFileSync(new URL('../src/dash/template.html', import.meta.url), 'utf8') }
})

const T0 = new Date('2026-10-16T10:00:00.000Z')
const minutes = (n: number): string => new Date(T0.getTime() + n * 60_000).toISOString()

let root: string
let stdout: string[]
let stderr: string[]

const dash = async (minute: number, ...args: string[]): Promise<number> => {
  vi.setSystemTime(minutes(minute))
  return runDash(args)
}

const runDir = (): string => join(root, '.jig', 'runs', 'feat_dash-x')
const readRunJson = (): unknown => JSON.parse(readFileSync(join(runDir(), 'run.json'), 'utf8'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-dash-'))
  execFileSync('git', ['init', '-q', '-b', 'feat/dash-x'], { cwd: root })
  vi.stubEnv('CLAUDE_PROJECT_DIR', root)
  vi.useFakeTimers({ toFake: ['Date'] })
  stdout = []
  stderr = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('jig dash', () => {
  it('turns a command sequence into the expected run.json and page', async () => {
    expect(await dash(0, 'init', 'Ship dash', 'Plan', 'Build', 'Verify')).toBe(0)
    expect(await dash(1, 'step', '1', 'done')).toBe(0)
    expect(await dash(2, 'step', '2', 'active')).toBe(0)
    expect(await dash(3, 'decision', 'Use a JSON block', '--why', 'page draws itself', '--evidence', 'template.html:1')).toBe(0)
    expect(await dash(4, 'decision', 'Inline fonts', '--result', 'reverted')).toBe(0)
    expect(await dash(5, 'ask', 'Dark theme default?', 'yes')).toBe(0)
    expect(await dash(6, 'step', '3', 'blocked', 'review')).toBe(0)
    expect(await dash(7, 'add', 'Report')).toBe(0)
    expect(await dash(8, 'result', 'Screenshot', 'shot.png')).toBe(0)
    expect(await dash(9, 'answer', '1', 'no')).toBe(0)

    expect(stdout).toEqual([
      `${root.replace(/\\/g, '/')}/.jig/runs/feat_dash-x/index.html\n`,
      'ok\n', 'ok\n', 'ok\n', 'ok\n', '1\n', 'ok\n', 'ok\n', 'ok\n', 'ok\n',
    ])
    expect(readRunJson()).toEqual({
      v: 1,
      title: 'Ship dash',
      branch: 'feat_dash-x',
      createdAt: minutes(0),
      updatedAt: minutes(9),
      steps: [
        { n: 1, title: 'Plan', status: 'done', at: minutes(1) },
        { n: 2, title: 'Build', status: 'active', at: minutes(2) },
        { n: 3, title: 'Verify', status: 'blocked', waitsFor: 'review', at: minutes(6) },
        { n: 4, title: 'Report', status: 'todo', at: minutes(7) },
      ],
      decisions: [
        { n: 1, text: 'Use a JSON block', why: 'page draws itself', evidence: 'template.html:1', at: minutes(3) },
        { n: 2, text: 'Inline fonts', result: 'reverted', at: minutes(4) },
        { n: 3, text: 'Dark theme default? no', at: minutes(9) },
      ],
      results: [{ title: 'Screenshot', href: 'shot.png', at: minutes(8) }],
      asks: [{ n: 1, question: 'Dark theme default?', default: 'yes', answer: 'no', askedAt: minutes(5), answeredAt: minutes(9) }],
    })

    const page = readFileSync(join(runDir(), 'index.html'), 'utf8')
    const block = /<script type="application\/json" id="run">([\s\S]*?)<\/script>/.exec(page)
    expect(JSON.parse(block?.[1] ?? '')).toEqual(readRunJson())
  })

  it('keeps an existing run when init repeats the same title and steps', async () => {
    await dash(0, 'init', 'Ship dash', 'Plan', 'Build')
    await dash(1, 'step', '1', 'done')
    await dash(2, 'init', 'Ship dash', 'Plan', 'Build')

    expect(readRunJson()).toMatchObject({ createdAt: minutes(0), updatedAt: minutes(2), steps: [{ status: 'done' }, { status: 'todo' }] })
  })

  it('escapes </script> in run text so the page block stays parseable', async () => {
    await dash(0, 'init', 'Break </script><b>', 'Plan')

    const page = readFileSync(join(runDir(), 'index.html'), 'utf8')
    const block = /<script type="application\/json" id="run">([\s\S]*?)<\/script>/.exec(page)
    expect(JSON.parse(block?.[1] ?? '')).toMatchObject({ title: 'Break </script><b>' })
  })

  it('exits 1 on a wrong number and when the run went quiet for 12 hours', async () => {
    await dash(0, 'init', 'Ship dash', 'Plan')

    expect(await dash(1, 'step', '5', 'done')).toBe(1)
    expect(await dash(1, 'answer', '1', 'yes')).toBe(1)
    expect(await dash(12 * 60, 'path')).toBe(1)
    expect(stderr.at(-1)).toMatch(/^jig: no active run for branch feat_dash-x/)
  })

  it('reports the active run for session-start only while the heartbeat is younger than 12 hours', async () => {
    await dash(0, 'init', 'Ship dash', 'Plan', 'Build')
    await dash(1, 'step', '1', 'done')
    await dash(2, 'step', '2', 'active')

    const page = `${root.replace(/\\/g, '/')}/.jig/runs/feat_dash-x/index.html`
    expect(activeRunContext(root, new Date(minutes(3)))).toBe(`jig: flow run "Ship dash", step 2 "Build", dashboard ${page}`)
    expect(activeRunContext(root, new Date(minutes(2 + 12 * 60)))).toBeUndefined()
  })
})
