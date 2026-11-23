import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { figmaApiKey, parseFigmaUrl } from '../src/ui/mockup/fetch'
import { ui } from '../src/ui/ui'

const EXPORT = `NAME: "t"

GLOBAL_VARS:
fill_a:
  - '#FF0000'

NODES:
[FRAME] "frame" #1:1 layout={"mode":"none"}
  [GROUP] "Comp" #1:2 layout={"mode":"none"}
    [GROUP] "v1" #1:3 layout={"mode":"none","dimensions":{"width":10,"height":10}}
      [RECTANGLE] #1:4 layout={"mode":"none","dimensions":{"width":14,"height":99}} fills=fill_a borderRadius=2px
      [TEXT] #1:5 fills=fill_a textStyle={"fontFamily":"Onest","fontWeight":700,"fontSize":15} text="Value"
  [TEXT] #1:6 text="Сохранить"
`

let root: string
let out: string[]
let err: string[]

const write = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

const gitIn = (...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  expect(result.ok, result.stderr).toBe(true)
}

const mockup = (...args: string[]): number => ui(['mockup', ...args], { cwd: root, io: { out: (text) => out.push(text), err: (text) => err.push(text) } })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-ui-mockup-'))
  out = []
  err = []
  gitIn('init', '-q', '-b', 'main')
  write('export.yaml', EXPORT)
  write('src/comp/view.ts', "export const FONT = { fontSize: 12 }\nexport const fill = '#00FF00'\nexport const save = 'Сохранить'\n")
  gitIn('add', '-A')
  gitIn('commit', '-q', '-m', 'base')
  gitIn('checkout', '-q', '-b', 'feat')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig ui mockup', () => {
  it('lists the top nodes of the frame without --component', () => {
    expect(mockup('--export', 'export.yaml')).toBe(0)
    expect(out.join('')).toMatch(/^Top nodes of the frame[\s\S]*1:2 {2}GROUP "Comp" {2}\d+ nodes/)
  })

  it('names every blocking class of the report and exits 1', () => {
    write('src/comp/view.ts', "export const FONT = { fontSize: 12 }\nexport const fill = '#00FF00'\nexport const save = 'Сохранить'\nexport const title = 'Привет'\nexport const again = 'Сохранить'\n")
    expect(mockup('--export', 'export.yaml', '--component', '1:2', '--base', 'main', '--role', 'Value=fontSize', 'src/comp')).toBe(1)
    const text = out.join('')
    expect(text).toMatch(/^MISSING #FF0000/m)
    expect(text).toMatch(/^EXTRA {3}#00FF00 {2}src\/comp\/view\.ts:2/m)
    expect(text).toMatch(/TYPO fontSize = 12 at src\/comp\/view\.ts:1; mockup 15/)
    expect(text).toMatch(/^NOT IN MOCKUP "Привет"/m)
    expect(text).toMatch(/^DUPLICATE {5}"Сохранить" {2}now 2×, was 1×: src\/comp\/view\.ts:3, src\/comp\/view\.ts:5/m)
    expect(text).toContain('summary: 1 MISSING, 1 EXTRA, 1 NOT IN MOCKUP, 1 DUPLICATE, 1 TYPOGRAPHY')
    expect(text).toMatch(/\nFAIL\. /)
  })

  it('takes the Figma key from JIG_FIGMA_API_KEY before FIGMA_API_KEY and reads file key and node from the URL', () => {
    expect(figmaApiKey({ JIG_FIGMA_API_KEY: 'jig', FIGMA_API_KEY: 'other' })).toBe('jig')
    expect(figmaApiKey({ FIGMA_API_KEY: 'other' })).toBe('other')
    expect(figmaApiKey({})).toBeUndefined()
    expect(parseFigmaUrl('https://www.figma.com/design/AbC123/x?node-id=4067-47270')).toEqual({ fileKey: 'AbC123', nodeId: '4067:47270' })
  })
})
