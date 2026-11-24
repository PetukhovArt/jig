import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { preMr, skipVerify, type PreMrContext } from '../src/pre-mr/pre-mr'
import { ui } from '../src/ui/ui'

const PROFILE = JSON.stringify({
  ui: {
    targets: [{ name: 'web', runtime: 'browser', widths: [1280] }],
    themes: [{ name: 'light' }],
    components: { dirs: ['src/shared/ui'], map: { button: 'Button' } },
  },
})

const TREE = JSON.stringify({ version: 1, nodes: [{ id: 'a', text: 'Hi' }] })

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

const io = { out: (text: string) => out.push(text), err: (text: string) => err.push(text) }
const context = (): PreMrContext => ({ cwd: root, io })
const run = (...args: string[]): number => preMr(args, context())
const uiRun = (...args: string[]): number => ui(args, { cwd: root, io })
const proofs = (): string[] => readJournal(root).filter((record) => record.kind === 'proof').map((record) => record.rule ?? '')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-ui-pre-mr-'))
  out = []
  err = []
  gitIn('init', '-q', '-b', 'main')
  write('.jig/config.jsonc', PROFILE)
  write('src/Page.tsx', 'export const Page = () => <div />\n')
  gitIn('add', '-A')
  gitIn('commit', '-q', '-m', 'base')
  gitIn('checkout', '-q', '-b', 'feature')
  write('src/Page.tsx', 'export const Page = () => <span />\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig pre-mr with a ui profile', () => {
  it('asks for the scope judgement first, whatever files changed', () => {
    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-scope: not recorded. Run: jig ui scope ui|none "<why>"')
  })

  it('passes with scope none and prints the reason, asking for no other receipt', () => {
    expect(uiRun('scope', 'none', 'the change is a rename in a service')).toBe(0)
    out = []
    expect(run('main')).toBe(0)
    expect(out.join('')).toContain('UI scope: none (the change is a rename in a service)')
  })

  it('refuses the other ui commands until the references are listed or none is recorded', () => {
    expect(uiRun('reuse', '--base', 'main')).toBe(2)
    expect(err.join('')).toContain('step 2 of flow ui')
    expect(uiRun('reference', 'none', 'the user has no design')).toBe(0)
    expect(uiRun('reuse', '--base', 'main')).toBe(0)
  })

  it('with scope ui asks for the reference, ui-reuse and ui-matrix, and for a mockup of every reference with a tree', () => {
    expect(uiRun('scope', 'ui', 'a new page')).toBe(0)
    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-reference: not recorded')
    expect(err.join('')).toContain('- ui-reuse: not recorded')
    expect(err.join('')).toContain('- ui-matrix: not recorded')
    expect(err.join('')).not.toContain('ui-mockup')

    write('tree.json', TREE)
    expect(uiRun('reference', 'add', 'design-file', '--covers', 'the page')).toBe(0)
    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-reference:1: not recorded. Run: jig ui reference attach 1')
    expect(uiRun('reference', 'attach', '1', '--tree', 'tree.json')).toBe(0)
    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-mockup:1: not recorded. Run: jig ui mockup 1')
    expect(err.join('')).not.toContain('- ui-reference')
  })

  it('counts a passing jig ui reuse until any file of the branch is edited, and records nothing while a raw element stands', () => {
    expect(uiRun('scope', 'ui', 'a page')).toBe(0)
    expect(uiRun('reference', 'none', 'no design')).toBe(0)
    write('src/Page.tsx', 'export const Page = () => <button>go</button>\n')
    expect(uiRun('reuse', '--base', 'main')).toBe(1)
    expect(proofs()).toEqual(['ui-scope', 'ui-reference'])

    write('src/Page.tsx', 'export const Page = () => <span />\n')
    expect(uiRun('reuse', '--base', 'main')).toBe(0)
    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).not.toContain('- ui-reuse')

    write('notes.txt', 'edited after the receipt\n')
    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).toMatch(/- ui-reuse: last receipt at \S+ \(`jig ui reuse: [^`]+`\) predates edits/)
  })

  it('jig skip-verify waives only ui-matrix', () => {
    expect(uiRun('scope', 'ui', 'a page')).toBe(0)
    expect(skipVerify(['--level', 'unit-test', '--why', 'no app here'], context())).toBe(0)

    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-reference: not recorded')
    expect(err.join('')).toContain('- ui-reuse: not recorded')
    expect(err.join('')).not.toContain('ui-matrix')
    expect(err.join('')).toContain('jig skip-verify does not waive them')

    expect(uiRun('reference', 'none', 'no design')).toBe(0)
    expect(uiRun('reuse', '--base', 'main')).toBe(0)
    skipVerify(['--level', 'unit-test', '--why', 'no app here'], context())
    out = []
    expect(run('main')).toBe(0)
    expect(out.join('')).toContain('not proven: ui-matrix')
    expect(out.join('')).toContain('Break-it: recommended')
  })
})
