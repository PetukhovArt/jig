import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateConfig } from '../src/core/config'
import { ensureJigDir } from '../src/core/paths'
import { git } from '../src/core/git'
import { ui, type UiContext } from '../src/ui/ui'

const desktop = { name: 'desktop', runtime: 'tauri', widths: [1280, 1920], height: 900, minWidth: 1024, input: 'fine' }
const phone = { name: 'phone', runtime: 'browser', widths: [390], height: 844, input: 'coarse' }
const ios = { name: 'ios', runtime: 'native', proof: 'manual' }
const themes = [
  { name: 'light', switch: { media: 'light' } },
  { name: 'dark', switch: { act: 'settings/theme-dark' } },
]
const locales = {
  list: [
    { name: 'ru', switch: { launch: 'LANG=ru' } },
    { name: 'en', switch: { act: 'settings/lang-en' } },
  ],
  check: 'one',
}

const errorsOf = (value: unknown): string[] => validateConfig({ ui: value }).errors

describe('config ui', () => {
  it('reads the profile of the spec', () => {
    const { config, errors } = validateConfig({
      ui: { targets: [desktop, phone, ios], themes, locales, components: { dirs: ['src/shared/ui'], map: { button: 'Button (@/shared/ui/buttons)' } }, tokens: ['src/tokens.json'] },
    })
    expect(errors).toEqual([])
    expect(config.ui?.targets.map((target) => [target.name, target.proof])).toEqual([
      ['desktop', 'auto'],
      ['phone', 'auto'],
      ['ios', 'manual'],
    ])
    expect(config.ui?.locales?.check).toBe('one')
  })

  it('takes a single theme and a single locale without a switch', () => {
    expect(errorsOf({ targets: [desktop], themes: [{ name: 'light' }], locales: { list: [{ name: 'ru' }] } })).toEqual([])
  })

  it.each<[string, unknown, string[]]>([
    ['targets and themes are required', {}, ['$.ui.targets: is required', '$.ui.themes: is required']],
    ['unknown key', { targets: [desktop], themes: [{ name: 'l' }], extra: 1 }, ['$.ui.extra: unknown key']],
    ['native auto', { targets: [{ ...ios, proof: 'auto' }], themes: [{ name: 'l' }] }, ['$.ui.targets[0].proof: a native target is proven by hand: expected manual']],
    ['browser without widths', { targets: [{ name: 'b', runtime: 'browser' }], themes: [{ name: 'l' }] }, ['$.ui.targets[0].widths: is required']],
    ['width below minWidth', { targets: [{ ...desktop, widths: [800, 1280] }], themes: [{ name: 'l' }] }, ['$.ui.targets[0].widths[0]: 800 is below minWidth 1024']],
    ['bad runtime', { targets: [{ ...desktop, runtime: 'deno' }], themes: [{ name: 'l' }] }, ['$.ui.targets[0].runtime: expected one of electron, tauri, browser, native']],
    ['duplicate target', { targets: [desktop, desktop], themes: [{ name: 'l' }] }, ['$.ui.targets[1].name: duplicate name desktop']],
    ['switch needed for two themes', { targets: [desktop], themes: [{ name: 'a' }, { name: 'b', switch: { media: 'dark' } }] }, ['$.ui.themes[0].switch: is required when the list has more than one entry']],
    ['two switch kinds', { targets: [desktop], themes: [{ name: 'a', switch: { media: 'light', act: 'x' } }] }, ['$.ui.themes[0].switch: expected exactly one of media, act, launch']],
    ['locale by media', { targets: [desktop], themes: [{ name: 'l' }], locales: { list: [{ name: 'ru', switch: { media: 'ru' } }] } }, ['$.ui.locales.list[0].switch.media: is not available here, expected act or launch']],
    ['locales without list', { targets: [desktop], themes: [{ name: 'l' }], locales: { check: 'one' } }, ['$.ui.locales.list: is required']],
  ])('%s', (_name, value, expected) => {
    expect(errorsOf(value)).toEqual(expected)
  })
})

describe('ui matrix', () => {
  let out: string[] = []
  let err: string[] = []
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
    out = []
    err = []
  })

  const project = (config: unknown): UiContext => {
    const cwd = mkdtempSync(join(tmpdir(), 'jig-ui-'))
    roots.push(cwd)
    git(['init', '-q', '-b', 'main'], cwd)
    mkdirSync(join(cwd, '.jig'))
    writeFileSync(join(cwd, '.jig', 'config.jsonc'), JSON.stringify(config))
    return { cwd, io: { out: (text) => out.push(text), err: (text) => err.push(text) } }
  }

  const profile = { ui: { targets: [desktop, phone, ios], themes, locales } }

  it('lists target x width x theme with the first locale, manual targets apart', () => {
    const ctx = project(profile)
    expect(ui(['matrix', '--json'], ctx)).toBe(0)
    const matrix = JSON.parse(out.join(''))
    expect(matrix.combos.map((combo: { target: string; width: number; theme: string; locale: string }) => `${combo.target} ${combo.width} ${combo.theme} ${combo.locale}`)).toEqual([
      'desktop 1280 light ru',
      'desktop 1280 dark ru',
      'desktop 1920 light ru',
      'desktop 1920 dark ru',
      'phone 390 light ru',
      'phone 390 dark ru',
    ])
    expect(matrix.manual).toEqual([{ name: 'ios', runtime: 'native', widths: [] }])
  })

  it('takes every locale with --locales all or check all', () => {
    expect(ui(['matrix', '--locales', 'all', '--json'], project(profile))).toBe(0)
    expect(JSON.parse(out.join('')).combos).toHaveLength(12)
    out = []
    expect(ui(['matrix', '--json'], project({ ui: { ...profile.ui, locales: { ...locales, check: 'all' } } }))).toBe(0)
    expect(JSON.parse(out.join('')).combos).toHaveLength(12)
  })

  it('prints a text table with the switches and the manual targets', () => {
    expect(ui(['matrix'], project(profile))).toBe(0)
    const text = out.join('')
    expect(text).toMatch(/^6 combos to prove \(locales: one, the first listed\)/)
    expect(text).toContain('theme dark (act settings/theme-dark)')
    expect(text).toContain('locale ru (launch LANG=ru)')
    expect(text).toMatch(/manual targets[^\n]*\n {2}ios {2}native/)
  })

  it('fails with a message when the project has no ui section, and on a bad usage', () => {
    const ctx = project({})
    expect(() => ui(['matrix'], ctx)).toThrow(/no "ui" section/)
    expect(ui(['matrix', '--locales', 'some'], ctx)).toBe(2)
    expect(ui(['nothing'], ctx)).toBe(2)
    expect(err.join('')).toContain('usage: jig ui matrix')
  })
})

describe('ensureJigDir', () => {
  it('ignores ui/ in a new and in an existing .jig/.gitignore', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-ignore-'))
    try {
      ensureJigDir(root)
      expect(readFileSync(join(root, '.jig', '.gitignore'), 'utf8').split('\n')).toContain('ui/')
      writeFileSync(join(root, '.jig', '.gitignore'), 'journal/\nconfig.local.jsonc')
      ensureJigDir(root)
      expect(readFileSync(join(root, '.jig', '.gitignore'), 'utf8')).toBe('journal/\nconfig.local.jsonc\nui/\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
