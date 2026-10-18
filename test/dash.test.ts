import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
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

interface DrawnPage {
  lang: string
  html: string
  answersText: (drafts: Record<number, string>) => { count: number; text: string }
}

const drawPage = (page: string): DrawnPage => {
  const data = /<script type="application\/json" id="run">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''
  const app = { innerHTML: '' }
  const htmlElement = { lang: '' }
  const element = { addEventListener: () => undefined }
  const document = {
    title: '',
    documentElement: htmlElement,
    body: { classList: { toggle: () => false } },
    getElementById: (id: string) => (id === 'run' ? { textContent: data } : app),
    querySelector: () => element,
    querySelectorAll: () => [],
  }
  const context: Record<string, unknown> = {
    document,
    localStorage: { getItem: () => null },
    location: { pathname: '/run/index.html' },
    setInterval: () => 0,
  }
  runInNewContext(script, context)
  return { lang: htmlElement.lang, html: app.innerHTML, answersText: context['answersText'] as DrawnPage['answersText'] }
}

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
    expect(await dash(0, 'init', '--lang', 'en', 'Ship dash', 'Plan', 'Build', 'Verify')).toBe(0)
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
      lang: 'en',
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

  it.each([
    { title: 'Ship dash', lang: 'ru', label: 'сейчас здесь', foreign: 'now here' },
    { title: 'Выпустить дашборд', lang: 'en', label: 'now here', foreign: 'сейчас здесь' },
  ])('draws $lang labels from --lang whatever the title "$title" is written in', async ({ title, lang, label, foreign }) => {
    await dash(0, 'init', '--lang', lang, title, 'Plan')

    const drawn = drawPage(readFileSync(join(runDir(), 'index.html'), 'utf8'))
    expect(drawn.lang).toBe(lang)
    expect(drawn.html).toContain(label)
    expect(drawn.html).not.toContain(foreign)
  })

  it('copies drafted answers of open questions only, in question order', async () => {
    await dash(0, 'init', '--lang', 'ru', 'Сборка jig', 'План')
    await dash(1, 'ask', 'Тема по умолчанию?', 'тёмная')
    await dash(2, 'ask', 'Чем хостить?', 'glab')
    await dash(3, 'ask', 'Сколько окон?', 'два')
    await dash(4, 'ask', 'Уже отвечен?', 'да')
    await dash(5, 'answer', '4', 'да')

    const page = drawPage(readFileSync(join(runDir(), 'index.html'), 'utf8'))
    const copied = page.answersText({ 3: 'три\nили четыре', 1: 'светлая', 2: '   ', 4: 'лишний' })

    expect(copied).toEqual({
      count: 2,
      text: 'Ответы по прогону «Сборка jig»:\n№1 Тема по умолчанию?\n→ светлая\n\n№3 Сколько окон?\n→ три\nили четыре',
    })
    expect(page.answersText({})).toEqual({ count: 0, text: '' })
  })

  it('keeps an existing run when init repeats the same title and steps', async () => {
    await dash(0, 'init', '--lang', 'en', 'Ship dash', 'Plan', 'Build')
    await dash(1, 'step', '1', 'done')
    await dash(2, 'init', '--lang', 'en', 'Ship dash', 'Plan', 'Build')

    expect(readRunJson()).toMatchObject({ createdAt: minutes(0), updatedAt: minutes(2), steps: [{ status: 'done' }, { status: 'todo' }] })
  })

  it('escapes </script> in run text so the page block stays parseable', async () => {
    await dash(0, 'init', '--lang', 'en', 'Break </script><b>', 'Plan')

    const page = readFileSync(join(runDir(), 'index.html'), 'utf8')
    const block = /<script type="application\/json" id="run">([\s\S]*?)<\/script>/.exec(page)
    expect(JSON.parse(block?.[1] ?? '')).toMatchObject({ title: 'Break </script><b>' })
  })

  it('exits 1 on a wrong number and when the run went quiet for 12 hours', async () => {
    await dash(0, 'init', '--lang', 'en', 'Ship dash', 'Plan')

    expect(await dash(1, 'step', '5', 'done')).toBe(1)
    expect(await dash(1, 'answer', '1', 'yes')).toBe(1)
    expect(await dash(12 * 60, 'path')).toBe(1)
    expect(stderr.at(-1)).toMatch(/^jig: no active run for branch feat_dash-x/)
  })

  it('reports the active run for session-start only while the heartbeat is younger than 12 hours', async () => {
    await dash(0, 'init', '--lang', 'en', 'Ship dash', 'Plan', 'Build')
    await dash(1, 'step', '1', 'done')
    await dash(2, 'step', '2', 'active')

    const page = `${root.replace(/\\/g, '/')}/.jig/runs/feat_dash-x/index.html`
    expect(activeRunContext(root, new Date(minutes(3)))).toBe(`jig: flow run "Ship dash", step 2 "Build", dashboard ${page}`)
    expect(activeRunContext(root, new Date(minutes(2 + 12 * 60)))).toBeUndefined()
  })
})
