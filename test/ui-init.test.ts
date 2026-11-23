import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateConfig } from '../src/core/config'
import { git } from '../src/core/git'
import { buildInitReport } from '../src/init/init'
import { detectUi } from '../src/init/ui/ui'

let root: string

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const pkg = (...deps: string[]): void => write('package.json', JSON.stringify({ dependencies: Object.fromEntries(deps.map((name) => [name, '1'])) }))

const detect = (...deps: string[]) => {
  pkg(...deps)
  return detectUi(root, deps)
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-ui-init-')))
  git(['init', '-q'], root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig init ui proposal', () => {
  it('proposes nothing for a project without UI signals', () => {
    write('src/main.rs', 'fn main() {}')
    expect(detect().proposal).toBeUndefined()
  })

  it('reads the runtime from dependencies and adds a native target by hand', () => {
    write('src/App.tsx', 'export const App = () => null')
    expect((detect('react', '@tauri-apps/api').proposal?.['targets'] as unknown[])[0]).toEqual({ name: 'desktop', runtime: 'tauri', widths: [1280, 1920] })
    expect((detect('react', 'electron').proposal?.['targets'] as unknown[])[0]).toMatchObject({ runtime: 'electron' })
    const capacitor = detect('react', 'react-dom', '@capacitor/core').proposal?.['targets'] as unknown[]
    expect(capacitor).toEqual([{ name: 'web', runtime: 'browser', widths: [1280, 1920] }, { name: 'mobile-app', runtime: 'native', proof: 'manual' }])
  })

  it('adds a coarse phone target only with a responsive signal, and for a desktop shell only with pointer: coarse', () => {
    write('src/App.tsx', 'export const App = () => null')
    expect(detect('react').proposal?.['targets']).toHaveLength(1)
    write('src/app.css', '@media (max-width: 600px) { .a { color: red } }')
    expect(detect('react').proposal?.['targets']).toEqual([
      { name: 'web', runtime: 'browser', widths: [1280, 1920] },
      { name: 'phone', runtime: 'browser', widths: [390], input: 'coarse' },
    ])
    expect(detect('react', 'electron').proposal?.['targets']).toHaveLength(1)
    write('src/touch.css', '@media (pointer: coarse) { .a { padding: 8px } }')
    expect(detect('react', 'electron').proposal?.['targets']).toHaveLength(2)
  })

  it('switches themes by media when the app follows prefers-color-scheme, else leaves marked TODO acts', () => {
    write('src/App.tsx', 'export const App = () => null')
    write('src/theme.css', '.dark { color: white }\n@media (prefers-color-scheme: dark) { :root { color: white } }')
    expect(detect('react').proposal?.['themes']).toEqual([
      { name: 'light', switch: { media: 'light' } },
      { name: 'dark', switch: { media: 'dark' } },
    ])
    write('src/theme.css', '.dark { color: white }')
    const manual = detect('react')
    expect(manual.proposal?.['themes']).toEqual([
      { name: 'light', switch: { act: expect.stringContaining('TODO') } },
      { name: 'dark', switch: { act: expect.stringContaining('TODO') } },
    ])
    expect(manual.questions.join('\n')).toContain('ui.themes')
  })

  it('takes theme names from data-theme and a single brand theme needs no switch', () => {
    write('src/App.tsx', 'export const App = () => null')
    write('src/theme.css', "html[data-theme='k'] { color: red }")
    expect(detect('react').proposal?.['themes']).toEqual([{ name: 'k' }])
  })

  it('reads UI library theme configs', () => {
    write('src/plugins/vuetify.js', 'createVuetify({ theme: { themes: { light: { colors: {} }, dark: { colors: {} } } } })')
    expect((detect('vue', 'vuetify').proposal?.['themes'] as { name: string }[]).map((theme) => theme.name)).toEqual(['light', 'dark'])
  })

  it('orders locales by the longest average string first and skips date-picker locale folders', () => {
    write('src/App.tsx', 'export const App = () => null')
    write('src/i18n/en.ts', "export default { a: 'Save', b: 'Open' }")
    write('src/i18n/ru.ts', "export default { a: 'Сохранить изменения', b: 'Открыть файл' }")
    write('src/components/datepicker/locale/de.js', "export default { a: 'Januar Januar Januar' }")
    write('src/components/datepicker/locale/fr.js', "export default { a: 'Janvier' }")
    const locales = detect('react').proposal?.['locales'] as { list: { name: string }[]; check: string }
    expect(locales.list.map((entry) => entry.name)).toEqual(['ru', 'en'])
    expect(locales.check).toBe('one')
  })

  it('finds shared component dirs, project wrappers and library fallbacks', () => {
    write('src/shared/ui/Button.tsx', 'export const Button = () => null')
    write('src/shared/ui/text-fields/input/Input.tsx', 'export const Input = () => null')
    write('src/shared/ui/select/index.ts', 'export {}')
    const own = detect('react').proposal?.['components']
    expect(own).toEqual({ dirs: ['src/shared/ui'], map: { button: 'Button', input: 'Input', select: 'Select' } })
    write('src/pages/Home.vue', '<template><v-btn /></template>')
    const library = detect('vue', 'vuetify').proposal?.['components'] as { map: Record<string, string> }
    expect(library.map).toMatchObject({ button: 'Button', textarea: 'v-textarea' })
  })

  it('proposes token folders and files, not auth token modules', () => {
    write('src/App.tsx', 'export const App = () => null')
    write('src/theme/tokens/colors.css', ':root {}')
    write('src/auth/tokens.ts', 'export const tokens = 1')
    expect(detect('react').proposal?.['tokens']).toEqual(['src/theme/tokens'])
  })

  it('puts a ui key into the init proposal that the config validator accepts, and leaves an existing ui alone', () => {
    write('src/App.tsx', 'export const App = () => null')
    write('src/theme.css', '.dark { color: white }')
    pkg('react')
    const fresh = buildInitReport(root, false)
    expect(fresh.proposal['ui']).toBeDefined()
    expect(fresh.uiNotes.length).toBeGreaterThan(0)
    expect(validateConfig(fresh.proposal).errors).toEqual([])
    write('.jig/config.jsonc', JSON.stringify({ ui: { targets: [{ name: 'x', runtime: 'browser', widths: [800] }], themes: [{ name: 'light' }] } }))
    const update = buildInitReport(root, true)
    expect(update.proposal['ui']).toEqual({ targets: [{ name: 'x', runtime: 'browser', widths: [800] }], themes: [{ name: 'light' }] })
    expect(update.uiNotes).toEqual([])
  })
})
