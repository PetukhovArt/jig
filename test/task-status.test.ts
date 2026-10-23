import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeRunContext, logToActiveJournal, parseJournal, runTaskStatus } from '../src/task-status/task-status'

const T0 = new Date('2026-10-16T10:00:00.000Z')
const minutes = (n: number): string => new Date(T0.getTime() + n * 60_000).toISOString()
const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'

let root: string
let stdout: string[]
let stderr: string[]

const taskStatus = async (minute: number, ...args: string[]): Promise<number> => {
  vi.setSystemTime(minutes(minute))
  return runTaskStatus(args)
}

const slash = (path: string): string => path.replace(/\\/g, '/')
const runDir = (): string => join(root, '.jig', 'runs', 'feat_status-x')
const journalText = (): string => readFileSync(join(runDir(), 'task-status.tsv'), 'utf8')
const pageText = (): string => readFileSync(join(runDir(), 'task-status.html'), 'utf8')
const pageData = (page: string): unknown => JSON.parse(/<script type="application\/json" id="status">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '')

interface DrawnPage {
  lang: string
  title: string
  html: string
}

const drawPage = (page: string): DrawnPage => {
  const data = /<script type="application\/json" id="status">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''
  const app = { innerHTML: '' }
  const htmlElement = { lang: '' }
  const document = {
    title: '',
    documentElement: htmlElement,
    body: { classList: { toggle: () => false } },
    getElementById: (id: string) => (id === 'status' ? { textContent: data } : app),
    querySelector: () => ({ addEventListener: () => undefined }),
    querySelectorAll: () => [],
  }
  runInNewContext(script, { document, location: { pathname: '/task-status.html' }, localStorage: { getItem: () => null } })
  return { lang: htmlElement.lang, title: document.title, html: app.innerHTML }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-task-status-'))
  execFileSync('git', ['init', '-q', '-b', 'feat/status-x'], { cwd: root })
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

describe('jig task-status log', () => {
  it('appends one TSV row per call under a single header, flags in any order', async () => {
    expect(await taskStatus(0, 'log', 'start', 'Ship task-status', '--evidence', 'agent a1')).toBe(0)
    expect(await taskStatus(1, 'log', 'step', 'Build', '--result', 'active')).toBe(0)
    expect(await taskStatus(2, 'log', '--why', 'page draws itself', 'design', 'Use a JSON block', '--evidence', 'template.html:1', '--result', 'kept')).toBe(0)
    expect(await taskStatus(3, 'log', 'question', 'Dark theme default?', '--why', 'yes, the common choice', '--result', 'open')).toBe(0)

    const journal = `${slash(root)}/.jig/runs/feat_status-x/task-status.tsv\n`
    expect(stdout).toEqual([journal, journal, journal, journal])
    expect(journalText()).toBe(
      [
        HEADER,
        `${minutes(0)}\tstart\tShip task-status\t\tagent a1\t`,
        `${minutes(1)}\tstep\tBuild\t\t\tactive`,
        `${minutes(2)}\tdesign\tUse a JSON block\tpage draws itself\ttemplate.html:1\tkept`,
        `${minutes(3)}\tquestion\tDark theme default?\tyes, the common choice\t\topen`,
        '',
      ].join('\n'),
    )
  })

  it('keeps every cell on one line and Windows paths byte for byte', async () => {
    const windowsPath = String.raw`C:\Users\me\new\table.ts:12`
    await taskStatus(0, 'log', 'fix\tphase', 'line one\nline two\r\nline three', '--why', 'tab\there', '--evidence', windowsPath, '--result', 'red\r')

    const lines = journalText().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]?.split('\t')).toEqual([minutes(0), 'fix phase', 'line one line two line three', 'tab here', windowsPath, 'red'])
    expect(parseJournal(journalText())).toEqual([
      { ts: minutes(0), phase: 'fix phase', decision: 'line one line two line three', why: 'tab here', evidence: windowsPath, result: 'red' },
    ])
  })

  it('reads a journal saved with CRLF line endings or extra cells', () => {
    const text = `${HEADER}\r\n${minutes(0)}\tstep\tBuild\t\t\tdone\r\n${minutes(1)}\tdesign\tA\tB\tC\tkept\textra\r\n`
    expect(parseJournal(text)).toEqual([
      { ts: minutes(0), phase: 'step', decision: 'Build', why: '', evidence: '', result: 'done' },
      { ts: minutes(1), phase: 'design', decision: 'A', why: 'B', evidence: 'C', result: 'kept extra' },
    ])
  })

  it.each([
    { args: ['log', 'step'], message: /usage: task-status log <phase> <decision>/ },
    { args: ['log', 'step', 'Build', 'extra'], message: /usage: task-status log/ },
    { args: ['log', 'step', 'Build', '--because', 'x'], message: /unknown option --because/ },
    { args: ['log', 'step', 'Build', '--why'], message: /--why needs a value/ },
    { args: ['log', '\t', 'Build'], message: /usage: task-status log/ },
    { args: ['ask', 'Q?', 'yes'], message: /unknown task-status subcommand ask/ },
  ])('exits 2 on $args without writing', async ({ args, message }) => {
    expect(await taskStatus(0, ...args)).toBe(2)
    expect(stderr.at(-1)).toMatch(message)
    expect(existsSync(join(runDir(), 'task-status.tsv'))).toBe(false)
  })
})

describe('jig task-status open', () => {
  it('builds the page from the TSV on demand and prints its path', async () => {
    await taskStatus(0, 'log', 'start', 'Ship </script><b>')
    await taskStatus(1, 'log', 'step', 'Plan', '--result', 'done')
    await taskStatus(2, 'log', 'step', 'Build', '--result', 'active')
    await taskStatus(3, 'log', 'question', 'Dark theme default?', '--why', 'yes', '--result', 'open')
    expect(existsSync(join(runDir(), 'task-status.html'))).toBe(false)

    stdout = []
    expect(await taskStatus(4, 'open', '--no-browser')).toBe(0)
    expect(stdout).toEqual([`${slash(root)}/.jig/runs/feat_status-x/task-status.html\n`])
    expect(pageData(pageText())).toEqual({
      branch: 'feat_status-x',
      journal: `${slash(root)}/.jig/runs/feat_status-x/task-status.tsv`,
      builtAt: minutes(4),
      lang: 'en',
      rows: parseJournal(journalText()),
    })

    const drawn = drawPage(pageText())
    expect(drawn.title).toBe('Ship </script><b>')
    expect(drawn.html).toContain('1<small> / 2 steps done</small>')
    expect(drawn.html).toContain('Open questions <span class="pill accent">1</span>')
    expect(drawn.html).toContain('<textarea class="reply" rows="2" placeholder="Your answer" aria-label="Answer to: Dark theme default?" hidden></textarea>')
    expect(drawn.html).toContain('<button class="copy" type="button">Copy answers</button>')
  })

  it('rebuilds the page with rows logged after the last open', async () => {
    await taskStatus(0, 'log', 'start', 'Ship')
    await taskStatus(1, 'open', '--no-browser')
    await taskStatus(2, 'log', 'design', 'Later decision')
    await taskStatus(3, 'open', '--no-browser')

    expect(pageData(pageText())).toMatchObject({ builtAt: minutes(3), rows: [{ decision: 'Ship' }, { decision: 'Later decision' }] })
  })

  it.each([
    { lang: 'ru', label: 'Открытые вопросы', foreign: 'Open questions' },
    { lang: 'en', label: 'Open questions', foreign: 'Открытые вопросы' },
  ])('draws $lang labels from --lang', async ({ lang, label, foreign }) => {
    await taskStatus(0, 'log', 'question', 'Какой хостинг?', '--why', 'glab')
    await taskStatus(1, 'open', '--no-browser', '--lang', lang)

    const drawn = drawPage(pageText())
    expect(drawn.lang).toBe(lang)
    expect(drawn.html).toContain(label)
    expect(drawn.html).not.toContain(foreign)
  })

  it('exits 1 without a journal and 2 on a wrong --lang', async () => {
    expect(await taskStatus(0, 'open', '--no-browser')).toBe(1)
    expect(stderr.at(-1)).toMatch(/^jig: no task-status journal for branch feat_status-x/)
    expect(await taskStatus(0, 'path')).toBe(1)

    await taskStatus(0, 'log', 'start', 'Ship')
    expect(await taskStatus(1, 'open', '--lang', 'de')).toBe(2)
    expect(await taskStatus(1, 'open', '--browser')).toBe(2)
    expect(stderr.at(-1)).toMatch(/usage: task-status open \[--lang en\|ru\] \[--no-browser\]/)
  })
})

describe('the active journal', () => {
  it('names the run for session-start only while the last row is younger than 12 hours', async () => {
    await taskStatus(0, 'log', 'start', 'Ship task-status')
    await taskStatus(2, 'log', 'step', 'Build', '--result', 'active')

    const journal = `${slash(root)}/.jig/runs/feat_status-x/task-status.tsv`
    expect(activeRunContext(root, new Date(minutes(3)))).toBe(`jig: task-status run "Ship task-status", last row step: "Build", journal ${journal}`)
    expect(activeRunContext(root, new Date(minutes(2 + 12 * 60)))).toBeUndefined()
  })

  it('takes gate rows only while a journal is active', async () => {
    expect(logToActiveJournal(root, { phase: 'gate', decision: 'gate unresolved' }, new Date(minutes(0)))).toBe(false)
    expect(existsSync(join(runDir(), 'task-status.tsv'))).toBe(false)

    await taskStatus(0, 'log', 'start', 'Ship')
    expect(logToActiveJournal(root, { phase: 'gate', decision: 'gate unresolved', why: 'no new edits' }, new Date(minutes(1)))).toBe(true)
    expect(parseJournal(journalText()).at(-1)).toEqual({ ts: minutes(1), phase: 'gate', decision: 'gate unresolved', why: 'no new edits', evidence: '', result: '' })
  })
})
