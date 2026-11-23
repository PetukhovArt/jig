import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { preMr, type PreMrContext } from '../src/pre-mr/pre-mr'
import { decodePng, encodePng } from '../src/ui/prove/png'
import type { AgentViewRunner, RunnerResult } from '../src/ui/prove/runner'
import { uiAsync } from '../src/ui/ui'

const PROFILE = {
  'agent-view': {},
  ui: {
    targets: [
      { name: 'desktop', runtime: 'electron', widths: [800], height: 600, input: 'fine' },
      { name: 'phone', runtime: 'electron', widths: [390], height: 844, input: 'coarse' },
      { name: 'ios', runtime: 'native', proof: 'manual' },
    ],
    themes: [
      { name: 'light', switch: { media: 'light' } },
      { name: 'dark', switch: { act: 'settings/theme-dark' } },
    ],
  },
}

const solid = (width: number, height: number, color: [number, number, number]): Buffer => {
  const rgba = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) rgba.set([...color, 255], pixel * 4)
  return encodePng({ width, height, rgba })
}

let root: string
let out: string[]
let err: string[]
let calls: string[][]

const write = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

const gitIn = (...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  expect(result.ok, result.stderr).toBe(true)
}

const ok = (stdout = ''): RunnerResult => ({ code: 0, stdout, stderr: '' })

const fakeAgentView = (failing: (width: number) => boolean = () => false, shotColor: [number, number, number] = [255, 255, 255]): AgentViewRunner => {
  let width = 0
  return (args) => {
    calls.push(args)
    const [command] = args
    if (command === 'emulate') {
      const at = args.indexOf('--width')
      if (at >= 0) width = Number(args[at + 1])
      return ok('{}')
    }
    if (command === 'screenshot') {
      const file = args[args.indexOf('--out') + 1] ?? ''
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, solid(width, 100, shotColor))
      return ok(file)
    }
    if (command === 'audit') {
      const finding = { rule: 'offscreen', severity: 'error', target: { testid: 'card', selector: '[data-testid=card]' }, rect: { x: 0, y: 0, width: 5, height: 5 }, detail: 'past the right edge' }
      const isFailing = failing(width)
      const shot = args[args.indexOf('--shot') + 1] ?? ''
      mkdirSync(dirname(shot), { recursive: true })
      writeFileSync(shot, solid(width, 100, [255, 0, 0]))
      const json = { viewport: { width }, scanned: 3, counts: { error: isFailing ? 1 : 0, warn: 0 }, findings: isFailing ? [finding] : [] }
      return { code: isFailing ? 1 : 0, stdout: JSON.stringify(json), stderr: '' }
    }
    return ok()
  }
}

const prove = (runner: AgentViewRunner, ...args: string[]): Promise<number> =>
  uiAsync(['prove', ...args], { cwd: root, io: { out: (text) => out.push(text), err: (text) => err.push(text) }, agentView: runner })

const preMrContext = (): PreMrContext => ({ cwd: root, io: { out: (text) => out.push(text), err: (text) => err.push(text) }, exec: () => 0 })
const proofs = (): string[] => readJournal(root).filter((record) => record.kind === 'proof').map((record) => record.rule ?? '')
const evidenceDir = (): string => join(root, '.jig', 'ui', 'feature')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-ui-prove-'))
  out = []
  err = []
  calls = []
  gitIn('init', '-q', '-b', 'main')
  write('.jig/config.jsonc', JSON.stringify(PROFILE))
  write('agent-view.config.json', '{"runtime":"electron","port":9222,"launch":"npm start"}')
  write('src/page.html', '<div></div>\n')
  gitIn('add', '-A')
  gitIn('commit', '-q', '-m', 'base')
  gitIn('checkout', '-q', '-b', 'feature')
  write('src/page.html', '<div>changed</div>\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig ui prove', () => {
  it('drives each combination, fails on an audit error without recording, and writes the evidence page', async () => {
    expect(await prove(fakeAgentView((width) => width === 390), '--root', 'card')).toBe(1)

    expect(calls.filter(([command]) => command === 'emulate').slice(0, 2)).toEqual([
      ['emulate', '--json'],
      ['emulate', '--reset', '--width', '800', '--height', '600', '--pointer', 'fine', '--color-scheme', 'light'],
    ])
    expect(calls).toContainEqual(['emulate', '--reset', '--width', '390', '--height', '844', '--pointer', 'coarse'])
    expect(calls).toContainEqual(['act', 'replay', 'settings/theme-dark'])
    expect(calls.at(-1)).toEqual(['emulate', '--reset'])
    expect(calls.find(([command]) => command === 'audit')).toContain('--root')
    expect(proofs()).toEqual([])
    expect(out.join('')).toContain('check by hand: ios')

    const page = readFileSync(join(evidenceDir(), 'index.html'), 'utf8')
    expect(page).toContain('phone · 390 x 844 px · coarse · theme light')
    expect(page).toContain('desktop · 800 x 600 px · fine · theme dark (act settings/theme-dark)')
    expect(page).toContain('<td>offscreen</td><td class="sev-error">error</td><td><code>testid=card</code></td><td>past the right edge</td>')
    expect(page).toContain('<code>ios</code>')
    expect(page).not.toMatch(/https?:\/\//)
    expect(existsSync(join(evidenceDir(), 'phone-390-light', 'screen-audit.png'))).toBe(true)
  })

  it('records ui-matrix once a clean run covers the whole matrix, and pre-mr counts it', async () => {
    write('.jig/ui/feature/deviations.md', '- radius 6 instead of 8: token --r-md\n')

    expect(await prove(fakeAgentView())).toBe(0)

    expect(proofs()).toEqual(['ui-matrix'])
    expect(readFileSync(join(evidenceDir(), 'index.html'), 'utf8')).toContain('radius 6 instead of 8')
    expect(preMr(['main'], preMrContext())).toBe(1)
    expect(err.join('')).not.toContain('- ui-matrix')
    expect(err.join('')).toContain('- behavior')
  })

  it('skips a launch-switched theme until the app is launched with it, and records no proof for a partial matrix', async () => {
    const themes = [{ name: 'light', switch: { media: 'light' } }, { name: 'dark', switch: { launch: 'THEME=dark' } }]
    write('.jig/config.jsonc', JSON.stringify({ ...PROFILE, ui: { ...PROFILE.ui, themes } }))

    expect(await prove(fakeAgentView())).toBe(0)
    expect(out.join('')).toContain('skipped desktop 800x600 fine theme dark: dark switches by launch (THEME=dark): relaunch the app with it and rerun with --launched dark')
    expect(err.join('')).toContain('ui-matrix proof not recorded')
    expect(proofs()).toEqual([])

    expect(await prove(fakeAgentView(), '--launched', 'dark')).toBe(0)
    expect(proofs()).toEqual(['ui-matrix'])
  })

  it('compares the result with an image reference and, with --exact, fails on a pixel difference', async () => {
    writeFileSync(join(root, 'ref.png'), solid(800, 100, [255, 255, 255]))

    expect(await prove(fakeAgentView(() => false, [255, 255, 255]), '--target', 'desktop', '--reference', 'image:ref.png', '--exact')).toBe(0)
    expect(JSON.parse(readFileSync(join(evidenceDir(), 'result.json'), 'utf8')).combos[0].states[0].diff.differing).toBe(0)

    expect(await prove(fakeAgentView(() => false, [250, 250, 250]), '--target', 'desktop', '--reference', 'image:ref.png', '--exact')).toBe(1)
    const diff = JSON.parse(readFileSync(join(evidenceDir(), 'result.json'), 'utf8')).combos[0].states[0].diff
    expect(diff.differing).toBe(800 * 100)
    expect(decodePng(readFileSync(join(evidenceDir(), diff.map))).width).toBe(800)
    expect(readFileSync(join(evidenceDir(), 'index.html'), 'utf8')).toContain('diff map: 100.00 % of pixels differ')
  })

  it('exits 2 when agent-view is not configured or cannot reach the app', async () => {
    expect(await prove(() => ({ code: 1, stdout: '', stderr: 'error: no window' }))).toBe(2)
    expect(err.join('')).toContain('agent-view cannot reach the app: error: no window')

    rmSync(join(root, 'agent-view.config.json'))
    err = []
    expect(await prove(fakeAgentView())).toBe(2)
    expect(err.join('')).toContain('agent-view is not configured')
  })
})
