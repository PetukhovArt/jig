import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { preMr, provenKinds, skipVerify, type PreMrContext } from '../src/pre-mr/pre-mr'
import { appendRow, journalLocation } from '../src/task-status/task-status'

const REPLAY = 'agent-view act replay checkout'
const SCREENSHOT = 'agent-view screenshot'

let dirs: string[] = []
let root: string
let out: string[]
let err: string[]
let exitCode: number
let commands: string[]

const write = (base: string, file: string, text: string): void => {
  mkdirSync(dirname(join(base, file)), { recursive: true })
  writeFileSync(join(base, file), text)
}

const gitIn = (cwd: string, ...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], cwd)
  expect(result.ok, result.stderr).toBe(true)
}

const context = (cwd: string = root): PreMrContext => ({
  cwd,
  io: { out: (text) => out.push(text), err: (text) => err.push(text) },
  exec: (command) => {
    commands.push(command)
    return exitCode
  },
})

const run = (args: string[], cwd?: string): number => preMr(args, context(cwd))
const skip = (args: string[]): number => skipVerify(args, context())
const stdout = (): string => out.join('')
const stderr = (): string => err.join('')
const proveAll = (cwd?: string): void => {
  expect(run(['proof', REPLAY], cwd)).toBe(0)
  expect(run(['proof', SCREENSHOT], cwd)).toBe(0)
  expect(run(['bug-bash', 'no bugs found; offline mode not tested'], cwd)).toBe(0)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-pre-mr-'))
  dirs.push(root)
  out = []
  err = []
  exitCode = 0
  commands = []
  gitIn(root, 'init', '-q', '-b', 'main')
  write(root, 'src/a.ts', 'export const a = 1\n')
  write(root, 'src/App.vue', '<template><div /></template>\n')
  write(root, 'src/app.css', '.a {}\n')
  write(root, '.jig/config.jsonc', '{ "agent-view": {} }\n')
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-qm', 'base')
  gitIn(root, 'checkout', '-qb', 'feature')
})

afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs = []
})

describe('jig pre-mr', () => {
  it('passes at level full when the branch touches no UI file', () => {
    write(root, 'src/a.ts', 'export const a = 2\n')

    expect(run(['main'])).toBe(0)
    expect(stdout()).toContain('UI files: none')
    expect(stdout()).toContain('Bug-bash: UI not touched')
    expect(stdout()).toContain('Verification level: full')
  })

  it('leaves UI files outside the given paths out of the proof', () => {
    write(root, 'src/a.ts', 'export const a = 2\n')
    write(root, 'src/App.vue', '<template><span /></template>\n')
    write(root, 'src/foreign.css', '.f {}\n')

    expect(run(['main', '--', 'src/a.ts'])).toBe(0)
    expect(stdout()).toContain('UI files: none')
  })

  it('reads paths after -- from the current directory and refuses a scope with no changes', () => {
    write(root, 'src/a.ts', 'export const a = 2\n')
    write(root, 'src/App.vue', '<template><span /></template>\n')

    expect(run(['main', '--', 'a.ts'], join(root, 'src'))).toBe(0)
    expect(stdout()).toContain('UI files: none')
    expect(() => run(['main', '--', 'src/a.ts'], join(root, 'src'))).toThrow('nothing changed against main under src/src/a.ts')
    expect(() => run(['main', '--', '../../elsewhere.ts'], join(root, 'src'))).toThrow('../../elsewhere.ts is outside the repository')
  })

  it('asks for no UI proof when the config names no proof tool', () => {
    write(root, '.jig/config.jsonc', '{}\n')
    write(root, 'src/App.vue', '<template><span /></template>\n')

    expect(run(['main'])).toBe(0)
    expect(stdout()).toContain('UI files: src/App.vue; no UI proof tool in .jig/config.jsonc')
    expect(stdout()).toContain('Verification level: no UI proof tool configured')
  })

  it('lists every missing proof and the bug-bash when UI files changed without them', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')
    write(root, 'src/new.css', '.b {}\n')

    expect(run(['main'])).toBe(1)
    expect(stderr()).toContain('- behavior: never proven for src/App.vue.')
    expect(stderr()).toContain('- look: never proven for src/App.vue, src/new.css.')
    expect(stderr()).toContain('- bug-bash: no record on this branch')
    expect(stderr()).toContain('jig skip-verify --level unit-test|type-check|none')
  })

  it('passes once a replay, a screenshot and a bug-bash cover the current UI files', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')
    proveAll()
    out = []

    expect(run(['main'])).toBe(0)
    expect(stdout()).toContain(`proof: \`${REPLAY}\``)
    expect(stdout()).toContain(`proof: \`${SCREENSHOT}\``)
    expect(stdout()).toContain('Bug-bash: no bugs found; offline mode not tested')
    expect(stdout()).toContain('Verification level: full')
    expect(commands).toEqual([REPLAY, SCREENSHOT])
  })

  it('fails when a UI file was edited after its replay, and passes again after a new replay', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')
    proveAll()
    write(root, 'src/App.vue', '<template><p /></template>\n')

    expect(run(['main'])).toBe(1)
    expect(stderr()).toMatch(/- behavior: last proof at \S+ \(`agent-view act replay checkout`\) predates edits for src\/App\.vue/)
    expect(stderr()).not.toContain('bug-bash: no record')

    err = []
    expect(run(['proof', REPLAY])).toBe(0)
    expect(run(['proof', SCREENSHOT])).toBe(0)
    expect(run(['main'])).toBe(0)
  })

  it('records nothing when the proof command fails and passes its exit code on', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')
    exitCode = 3

    expect(run(['proof', REPLAY])).toBe(3)
    expect(readJournal(root).filter((record) => record.kind === 'proof')).toEqual([])
  })

  it('accepts a replay recorded in a slot worktree showing the same commit', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')
    gitIn(root, 'commit', '-qam', 'feature')
    const slot = join(mkdtempSync(join(tmpdir(), 'jig-pre-mr-slot-')), 'slot')
    dirs.push(dirname(slot))
    gitIn(root, 'worktree', 'add', '-q', '--detach', slot, 'feature')

    proveAll(slot)
    expect(run(['main'])).toBe(0)
  })
})

describe('jig skip-verify', () => {
  it('records the level, lets pre-mr pass with the level line until the next edit', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')
    const location = journalLocation(root)
    appendRow(location.journal, { phase: 'start', decision: 'task' }, new Date())

    expect(skip(['--level', 'unit-test', '--why', 'no runnable app here'])).toBe(0)
    expect(stdout()).toContain('Verification level: unit-test (no runnable app here)')
    expect(readJournal(root).find((record) => record.kind === 'skip-verify')).toMatchObject({ rule: 'unit-test', message: 'no runnable app here' })
    expect(readFileSync(location.journal, 'utf8')).toMatch(/\tverify\tskip-verify:unit-test\tno runnable app here\t/)

    out = []
    expect(run(['main'])).toBe(0)
    expect(stdout()).toContain('not proven: behavior, look, bug-bash')
    expect(stdout()).toContain('Verification level: unit-test (no runnable app here)')

    write(root, 'src/App.vue', '<template><p /></template>\n')
    expect(run(['main'])).toBe(1)
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
    ['proof that proves nothing', () => run(['proof', 'npm test'])],
    ['proof without a command', () => run(['proof'])],
    ['bug-bash without a result', () => run(['bug-bash'])],
  ])('%s exits 2', (_name, call) => {
    expect(call()).toBe(2)
    expect(stderr()).toMatch(/^jig: /)
    expect(commands).toEqual([])
  })
})

describe('proof commands', () => {
  it.each([
    [REPLAY, ['behavior']],
    ['npx agent-view act replay checkout', ['behavior']],
    ['C:\\tools\\agent-view.cmd act replay checkout', ['behavior']],
    ['"C:\\Program Files\\nodejs\\agent-view.cmd" screenshot', ['look']],
    ['node_modules/.bin/agent-view snap', ['look']],
    ['agent-view act list', []],
  ])('%s proves %j', (command, kinds) => {
    expect(provenKinds(command).flatMap((entry) => entry.kinds)).toEqual(kinds)
  })

  it('records a Windows-path replay command as written', () => {
    write(root, 'src/App.vue', '<template><span /></template>\n')
    const command = 'C:\\tools\\agent-view.cmd act replay checkout'

    expect(run(['proof', command])).toBe(0)
    expect(readJournal(root).find((record) => record.kind === 'proof')).toMatchObject({ rule: 'behavior', tool: 'agent-view', message: command })
  })
})
