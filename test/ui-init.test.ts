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
  it('proposes nothing for a project without a UI framework dependency', () => {
    write('src/main.rs', 'fn main() {}')
    expect(detect().proposal).toBeUndefined()
  })

  it('reads the runtime from dependencies and adds a native target by hand', () => {
    expect((detect('react', '@tauri-apps/api').proposal?.['targets'] as unknown[])[0]).toEqual({ name: 'desktop', runtime: 'tauri', widths: [1280, 1920] })
    expect((detect('react', 'electron').proposal?.['targets'] as unknown[])[0]).toMatchObject({ runtime: 'electron' })
    const capacitor = detect('react', 'react-dom', '@capacitor/core').proposal?.['targets'] as unknown[]
    expect(capacitor).toEqual([{ name: 'web', runtime: 'browser', widths: [1280, 1920] }, { name: 'mobile-app', runtime: 'native', proof: 'manual' }])
  })

  it('puts a ui key into the init proposal that the config validator accepts, and leaves an existing ui alone', () => {
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
