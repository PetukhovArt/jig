import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { preMr, skipVerify, type PreMrContext } from '../src/pre-mr/pre-mr'
import { appendRow, journalLocation } from '../src/task-status/task-status'

let dirs: string[] = []
let root: string
let out: string[]
let err: string[]

const write = (base: string, file: string, text: string): void => {
  mkdirSync(dirname(join(base, file)), { recursive: true })
  writeFileSync(join(base, file), text)
}

const gitIn = (cwd: string, ...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], cwd)
  expect(result.ok, result.stderr).toBe(true)
}

const context = (cwd: string = root): PreMrContext => ({ cwd, io: { out: (text) => out.push(text), err: (text) => err.push(text) } })

const run = (args: string[], cwd?: string): number => preMr(args, context(cwd))
const skip = (args: string[]): number => skipVerify(args, context())
const stdout = (): string => out.join('')
const stderr = (): string => err.join('')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-pre-mr-'))
  dirs.push(root)
  out = []
  err = []
  gitIn(root, 'init', '-q', '-b', 'main')
  write(root, 'src/a.ts', 'export const a = 1\n')
  write(root, 'src/App.vue', '<template><div /></template>\n')
  write(root, '.jig/config.jsonc', '{}\n')
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-qm', 'base')
  gitIn(root, 'checkout', '-qb', 'feature')
})

afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs = []
})

describe('jig pre-mr', () => {
  it('asks for no UI receipt when the config has no ui section', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')

    expect(run(['main'])).toBe(0)
    expect(stdout()).toContain('UI: no ui section in .jig/config.jsonc, not checked')
    expect(stdout()).toContain('Verification level: full')
  })

  it('reads paths after -- from the current directory and refuses a scope with no changes', () => {
    write(root, 'src/a.ts', 'export const a = 2\n')

    expect(run(['main', '--', 'a.ts'], join(root, 'src'))).toBe(0)
    expect(() => run(['main', '--', 'src/a.ts'], join(root, 'src'))).toThrow('nothing changed against main under src/src/a.ts')
    expect(() => run(['main', '--', '../../elsewhere.ts'], join(root, 'src'))).toThrow('../../elsewhere.ts is outside the repository')
  })

  it('records a break-it result', () => {
    expect(run(['break-it', 'no bugs found; offline mode not tested'])).toBe(0)
    expect(readJournal(root).find((record) => record.kind === 'break-it')).toMatchObject({ message: 'no bugs found; offline mode not tested' })
  })
})

describe('jig skip-verify', () => {
  it('records the level and mirrors it to the task journal', () => {
    const location = journalLocation(root)
    appendRow(location.journal, { phase: 'start', decision: 'task' }, new Date())

    expect(skip(['--level', 'unit-test', '--why', 'no runnable app here'])).toBe(0)
    expect(stdout()).toContain('Verification level: unit-test (no runnable app here)')
    expect(readJournal(root).find((record) => record.kind === 'skip-verify')).toMatchObject({ rule: 'unit-test', message: 'no runnable app here' })
    expect(readFileSync(location.journal, 'utf8')).toMatch(/\tverify\tskip-verify:unit-test\tno runnable app here\t/)
  })
})

describe('arguments', () => {
  it.each([
    ['skip-verify without --why', () => skip(['--level', 'none'])],
    ['skip-verify with an unknown level', () => skip(['--level', 'e2e', '--why', 'x'])],
    ['skip-verify with an empty reason', () => skip(['--level', 'none', '--why', ' '])],
    ['skip-verify with an unknown option', () => skip(['--level', 'none', '--why', 'x', '--force'])],
    ['pre-mr with two bases', () => run(['main', 'other'])],
    ['pre-mr with an unknown option', () => run(['--json'])],
    ['pre-mr with no path after --', () => run(['main', '--'])],
    ['break-it without a result', () => run(['break-it'])],
  ])('%s exits 2', (_name, call) => {
    expect(call()).toBe(2)
    expect(stderr()).toMatch(/^jig: /)
  })
})
