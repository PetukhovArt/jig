import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { ui } from '../src/ui/ui'

const TREE = {
  version: 1,
  name: 't',
  nodes: [
    {
      id: 'frame',
      name: 'frame',
      children: [
        {
          id: 'comp',
          name: 'Comp',
          children: [
            {
              id: 'v1',
              name: 'v1',
              children: [
                { id: 'r1', kind: 'shape', fill: '#FF0000', bounds: { width: 14, height: 99 }, radius: 2 },
                { id: 't1', text: 'Value', fill: '#FF0000', font: { family: 'Sans', weight: 700, size: 15 } },
              ],
            },
          ],
        },
        { id: 't2', text: 'Save' },
      ],
    },
  ],
}

const TOKENS = { brand: { red: { $type: 'color', $value: '#FF0000', $extensions: { jig: { refs: ['brand.red', '--brand-red'], themes: { dark: '#EE0000' } } } } } }

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

const run = (...args: string[]): number => ui(args, { cwd: root, io: { out: (text) => out.push(text), err: (text) => err.push(text) } })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-ui-mockup-'))
  out = []
  err = []
  gitIn('init', '-q', '-b', 'main')
  write('.jig/config.jsonc', JSON.stringify({ ui: { targets: [{ name: 'web', runtime: 'browser', widths: [1280] }], themes: [{ name: 'light' }], tokens: 'tokens.json' } }))
  write('tree.json', JSON.stringify(TREE))
  write('tokens.json', JSON.stringify(TOKENS))
  write('src/comp/view.ts', "export const FONT = { fontSize: 12 }\nexport const fill = '#00FF00'\nexport const save = 'Save'\n")
  gitIn('add', '-A')
  gitIn('commit', '-q', '-m', 'base')
  gitIn('checkout', '-q', '-b', 'feat')
  expect(run('reference', 'add', 'design-file')).toBe(0)
  expect(run('reference', 'attach', '1', '--tree', 'tree.json')).toBe(0)
  out = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig ui mockup', () => {
  it('lists the top nodes of the tree without --component', () => {
    expect(run('mockup', '1')).toBe(0)
    expect(out.join('')).toMatch(/^Top nodes of the reference[\s\S]*comp {2}group "Comp" {2}\d+ nodes/)
  })

  it('names every blocking class of the report and exits 1', () => {
    write('src/comp/view.ts', "export const FONT = { fontSize: 12 }\nexport const fill = '#00FF00'\nexport const save = 'Save'\nexport const title = 'Hello'\nexport const again = 'Save'\n")
    expect(run('mockup', '1', '--component', 'comp', '--base', 'main', '--role', 'Value=fontSize', 'src/comp')).toBe(1)
    const text = out.join('')
    expect(text).toMatch(/^MISSING #FF0000/m)
    expect(text).toMatch(/^EXTRA {3}#00FF00 {2}src\/comp\/view\.ts:2/m)
    expect(text).toMatch(/TYPO fontSize = 12 at src\/comp\/view\.ts:1; mockup 15/)
    expect(text).toMatch(/^NOT IN MOCKUP "Hello"/m)
    expect(text).toMatch(/^DUPLICATE {5}"Save" {2}now 2×, was 1×: src\/comp\/view\.ts:3, src\/comp\/view\.ts:5/m)
    expect(text).toContain('summary: 1 MISSING, 1 EXTRA, 1 NOT IN MOCKUP, 1 DUPLICATE, 1 TYPOGRAPHY')
  })

  it('counts a color that a code name of a design token refers to, and reads the changed files when no path is given', () => {
    write('src/comp/view.ts', "export const FONT = { fontSize: 15 }\nexport const fill = 'brand.red'\n")
    expect(run('mockup', '1', '--component', 'comp', '--base', 'main', '--role', 'Value=fontSize')).toBe(0)
    expect(out.join('')).toMatch(/^ok {6}#FF0000 .*src\/comp\/view\.ts:2 \(brand\.red\)/m)
  })
})
