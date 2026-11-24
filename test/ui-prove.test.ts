import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { decodePng, encodePng } from '../src/ui/prove/png'
import type { CommandRunner } from '../src/ui/run'
import { ui, uiAsync } from '../src/ui/ui'

const PROFILE = {
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

const DRIVER = { prepare: 'prepare {theme}', capture: 'capture {width} {state} {out}', reset: 'reset' }

const solid = (width: number, height: number, color: [number, number, number]): Buffer => {
  const rgba = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) rgba.set([...color, 255], pixel * 4)
  return encodePng({ width, height, rgba })
}

const finding = { rule: 'offscreen', severity: 'error', target: { testid: 'card', selector: '[data-testid=card]' }, rect: { x: 0, y: 0, width: 5, height: 5 }, detail: 'past the right edge' }
const audit = (failing: boolean): string => JSON.stringify({ version: 1, audits: [{ kind: 'layout', scanned: 3, findings: failing ? [finding] : [] }] })

let root: string
let out: string[]
let err: string[]
let commands: string[]

const write = (file: string, text: string | Buffer): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

const gitIn = (...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  expect(result.ok, result.stderr).toBe(true)
}

const io = { out: (text: string) => out.push(text), err: (text: string) => err.push(text) }

const fakeDriver =
  (failing: (width: number) => boolean = () => false, shotColor: [number, number, number] = [255, 255, 255]): CommandRunner =>
  (command) => {
    commands.push(command)
    const capture = /^capture (\d+) \S+ "(.*)"$/.exec(command)
    if (capture === null) return { code: 0, stdout: '', stderr: '' }
    const width = Number(capture[1])
    const dir = capture[2] ?? ''
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'shot.png'), solid(width, 100, shotColor))
    writeFileSync(join(dir, 'audit.json'), audit(failing(width)))
    return { code: 0, stdout: '', stderr: '' }
  }

const prove = (...args: string[]): Promise<number> => uiAsync(['prove', ...args], { cwd: root, io })
const proveWith = (run: CommandRunner, ...args: string[]): Promise<number> => uiAsync(['prove', ...args], { cwd: root, io, run })
const proofs = (): string[] => readJournal(root).filter((record) => record.kind === 'proof').map((record) => record.rule ?? '')
const evidenceDir = (): string => join(root, '.jig', 'ui', 'feature')

const collected = (widthOf: (id: string, width: number) => number = (_id, width) => width): void => {
  for (const [id, width] of [['desktop-800-light', 800], ['desktop-800-dark', 800], ['phone-390-light', 390], ['phone-390-dark', 390]] as const) {
    write(`.jig/ui/feature/${id}/shot.png`, solid(widthOf(id, width), 100, [255, 255, 255]))
    write(`.jig/ui/feature/${id}/audit.json`, audit(false))
    write(`.jig/ui/feature/${id}/result.json`, JSON.stringify({ version: 1 }))
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-ui-prove-'))
  out = []
  err = []
  commands = []
  gitIn('init', '-q', '-b', 'main')
  write('.jig/config.jsonc', JSON.stringify(PROFILE))
  write('src/page.html', '<div></div>\n')
  gitIn('add', '-A')
  gitIn('commit', '-q', '-m', 'base')
  gitIn('checkout', '-q', '-b', 'feature')
  write('src/page.html', '<div>changed</div>\n')
  expect(ui(['reference', 'none', 'no design'], { cwd: root, io })).toBe(0)
  out = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig ui prove with ui.driver', () => {
  beforeEach(() => {
    write('.jig/config.jsonc', JSON.stringify({ ui: { ...PROFILE.ui, driver: DRIVER } }))
  })

  it('drives each combination, fails on an audit error without recording, and writes the evidence page', async () => {
    expect(await proveWith(fakeDriver((width) => width === 390))).toBe(1)

    expect(commands.filter((command) => command.startsWith('prepare'))).toEqual(['prepare "light"', 'prepare "dark"', 'prepare "light"', 'prepare "dark"'])
    expect(commands.at(-1)).toBe('reset')
    expect(proofs()).toEqual(['ui-reference'])
    expect(out.join('')).toContain('check by hand: ios')

    const page = readFileSync(join(evidenceDir(), 'index.html'), 'utf8')
    expect(page).toContain('phone · 390 x 844 px · coarse · theme light')
    expect(page).toContain('<td>offscreen</td><td class="sev-error">error</td><td><code>testid=card</code></td><td>past the right edge</td>')
    expect(page).toContain('<code>ios</code>')
    expect(page).not.toMatch(/https?:\/\//)
  })

  it('records ui-matrix once a clean run covers the whole matrix', async () => {
    write('.jig/ui/feature/deviations.md', '- radius 6 instead of 8: token --r-md\n')

    expect(await proveWith(fakeDriver())).toBe(0)

    expect(proofs()).toEqual(['ui-reference', 'ui-matrix'])
    expect(readFileSync(join(evidenceDir(), 'index.html'), 'utf8')).toContain('radius 6 instead of 8')
  })

  it('skips a launch-switched theme until the app is launched with it, and records no proof for a partial matrix', async () => {
    const themes = [{ name: 'light', switch: { media: 'light' } }, { name: 'dark', switch: { launch: 'THEME=dark' } }]
    write('.jig/config.jsonc', JSON.stringify({ ui: { ...PROFILE.ui, themes, driver: DRIVER } }))

    expect(await proveWith(fakeDriver())).toBe(0)
    expect(out.join('')).toContain('skipped desktop 800x600 fine theme dark: dark switches by launch (THEME=dark): relaunch the app with it and rerun with --launched dark')
    expect(err.join('')).toContain('ui-matrix proof not recorded')

    expect(await proveWith(fakeDriver(), '--launched', 'dark')).toBe(0)
    expect(proofs()).toContain('ui-matrix')
  })

  it('compares the result with the image of a reference and, with --exact, fails on a pixel difference', async () => {
    write('ref.png', solid(800, 100, [255, 255, 255]))
    expect(ui(['reference', 'add', 'old-build', '--covers', 'desktop light'], { cwd: root, io })).toBe(0)
    expect(ui(['reference', 'attach', '1', '--image', 'ref.png'], { cwd: root, io })).toBe(0)

    expect(await proveWith(fakeDriver(() => false, [255, 255, 255]), '--target', 'desktop', '--exact')).toBe(0)
    expect(JSON.parse(readFileSync(join(evidenceDir(), 'result.json'), 'utf8')).combos[0].states[0].diffs[0].differing).toBe(0)

    expect(await proveWith(fakeDriver(() => false, [250, 250, 250]), '--target', 'desktop', '--exact')).toBe(1)
    const diff = JSON.parse(readFileSync(join(evidenceDir(), 'result.json'), 'utf8')).combos[0].states[0].diffs[0]
    expect(diff.differing).toBe(800 * 100)
    expect(decodePng(readFileSync(join(evidenceDir(), diff.map))).width).toBe(800)
  })

  it('exits 2 and keeps the evidence of the combinations done when a capture command fails', async () => {
    const run: CommandRunner = (command) => (command.startsWith('capture 390') ? { code: 1, stdout: '', stderr: 'error: no window' } : fakeDriver()(command, root))
    expect(await proveWith(run)).toBe(2)
    expect(err.join('')).toContain('capture exited 1: error: no window')
    expect(existsSync(join(evidenceDir(), 'index.html'))).toBe(true)
  })
})

describe('jig ui prove --collect', () => {
  it('exits 2 explaining both ways when there is neither ui.driver nor --collect', async () => {
    expect(await prove()).toBe(2)
    expect(err.join('')).toContain('ui.driver')
    expect(err.join('')).toContain('jig ui prove --collect')
  })

  it('reads the results of every combination and records ui-matrix', async () => {
    collected()
    expect(await prove('--collect')).toBe(0)
    expect(proofs()).toContain('ui-matrix')
    expect(out.join('')).toContain('4 combinations read')
  })

  it('fails naming a missing combination and a shot of the wrong width, and records nothing', async () => {
    collected((id, width) => (id === 'phone-390-dark' ? width + 10 : width))
    rmSync(join(evidenceDir(), 'desktop-800-dark', 'result.json'))

    expect(await prove('--collect')).toBe(1)
    expect(err.join('')).toContain('desktop-800-dark/result.json: no result for desktop 800x600 fine theme dark')
    expect(err.join('')).toContain('phone-390-dark/shot.png is 400 px wide, the combination 390 px')
    expect(proofs()).not.toContain('ui-matrix')
  })
})
