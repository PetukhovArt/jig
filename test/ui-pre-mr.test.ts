import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { preMr, skipVerify, type PreMrContext } from '../src/pre-mr/pre-mr'
import { declareReference, declaredReference } from '../src/ui/dir'
import { ui } from '../src/ui/ui'

const PROFILE = JSON.stringify({
  'agent-view': {},
  ui: {
    targets: [{ name: 'web', runtime: 'browser', widths: [1280] }],
    themes: [{ name: 'light' }],
    components: { dirs: ['src/shared/ui'], map: { button: 'Button' } },
  },
})

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
const context = (): PreMrContext => ({ cwd: root, io, exec: () => 0 })
const run = (...args: string[]): number => preMr(args, context())
const reuse = (): number => ui(['reuse', '--base', 'main'], { cwd: root, io })
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
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig pre-mr with a ui profile', () => {
  it('asks for ui-reuse and ui-matrix when the branch changes a component, and names the command to run', () => {
    write('src/Page.tsx', 'export const Page = () => <span />\n')

    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-reuse: never proven for src/Page.tsx. Run: jig ui reuse')
    expect(err.join('')).toContain('- ui-matrix: never proven for src/Page.tsx. Run: jig ui prove')
    expect(err.join('')).not.toContain('ui-mockup')
  })

  it('counts a passing jig ui reuse until the covered file is edited, and records nothing while a raw element stands', () => {
    write('src/Page.tsx', 'export const Page = () => <button>go</button>\n')
    expect(reuse()).toBe(1)
    expect(proofs()).toEqual([])

    write('src/Page.tsx', 'export const Page = () => <span />\n')
    expect(reuse()).toBe(0)
    expect(proofs()).toEqual(['ui-reuse'])
    expect(run('main')).toBe(1)
    expect(err.join('')).not.toContain('- ui-reuse')

    write('src/Page.tsx', 'export const Page = () => <p />\n')
    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).toMatch(/- ui-reuse: last proof at \S+ \(`jig ui reuse: [^`]+`\) predates edits/)
  })

  it('asks for ui-mockup only once the branch declares a Figma reference', () => {
    write('src/Page.tsx', 'export const Page = () => <span />\n')
    declareReference(root, 'image:ref.png')
    expect(run('main')).toBe(1)
    expect(err.join('')).not.toContain('ui-mockup')

    declareReference(root, 'figma:https://www.figma.com/design/AbC/x?node-id=1-2')
    expect(declaredReference(root)).toBe('figma:https://www.figma.com/design/AbC/x?node-id=1-2')
    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-mockup: never proven for src/Page.tsx. Run: jig ui mockup --figma https://www.figma.com/design/AbC/x?node-id=1-2 --component <node id>')
  })

  it('keeps asking for the proofs that need no app after jig skip-verify', () => {
    write('src/Page.tsx', 'export const Page = () => <span />\n')
    declareReference(root, 'figma:https://www.figma.com/design/AbC/x?node-id=1-2')
    expect(skipVerify(['--level', 'unit-test', '--why', 'no app here'], { cwd: root, io })).toBe(0)

    err = []
    expect(run('main')).toBe(1)
    expect(err.join('')).toContain('- ui-reuse: never proven for src/Page.tsx')
    expect(err.join('')).toContain('- ui-mockup: never proven for src/Page.tsx')
    expect(err.join('')).not.toContain('ui-matrix')
    expect(err.join('')).toContain('need no running app, so jig skip-verify does not waive them')

    expect(reuse()).toBe(0)
    declareReference(root, 'image:ref.png')
    expect(skipVerify(['--level', 'unit-test', '--why', 'no app here'], { cwd: root, io })).toBe(0)
    out = []
    expect(run('main')).toBe(0)
    expect(out.join('')).toContain('not proven: behavior, look, ui-matrix, break-it')
  })

  it('passes on ui-reuse alone and skips break-it when no agent-view proof is configured', () => {
    write('.jig/config.jsonc', JSON.stringify({ ui: JSON.parse(PROFILE).ui }))
    write('src/Page.tsx', 'export const Page = () => <span />\n')

    expect(reuse()).toBe(0)
    out = []
    expect(run('main')).toBe(0)
    expect(out.join('')).toContain('proof: `jig ui reuse')
    expect(out.join('')).toContain('Break-it: not run, no agent-view proof asked')
    expect(out.join('')).toContain('Verification level: full')
  })
})
