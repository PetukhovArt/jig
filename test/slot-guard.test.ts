import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { clearOwner, ownerIdOf, ownerMarkerPath, refusalOf, writeOwner } from '../src/slot/guard'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

describe('ownerIdOf: who is calling slot show', () => {
  const processes = new Map([
    [10, { ppid: 20, name: 'bash.exe' }],
    [20, { ppid: 30, name: 'pwsh' }],
    [30, { ppid: 40, name: 'claude' }],
  ])
  const infoOf = (pid: number) => processes.get(pid)

  it('takes an explicit --owner first, then the session variable of a known agent, then the first non-shell ancestor', () => {
    const env = { CLAUDE_CODE_SESSION_ID: 'abc' }
    expect(ownerIdOf({ flag: 'mine', env, ppid: 10, infoOf })).toBe('mine')
    expect(ownerIdOf({ env, ppid: 10, infoOf })).toBe('claude:abc')
    expect(ownerIdOf({ env: {}, ppid: 10, infoOf })).toBe('pid:30')
  })

  it('falls back to the parent pid when the process table cannot be read', () => {
    expect(ownerIdOf({ env: {}, ppid: 77, infoOf: () => undefined })).toBe('pid:77')
  })
})

describe('refusalOf: a slot that remembers its owner', () => {
  let root: string
  let slot: string
  let first: string
  let second: string
  const now = Date.now()

  const sh = (cwd: string, ...args: string[]): string => {
    const result = git(args, cwd)
    if (!result.ok) throw new Error(result.stderr)
    return result.stdout.trim()
  }

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-slot-guard-')))
    const main = join(root, 'app')
    sh(root, 'init', '-q', '-b', 'main', main)
    sh(main, 'config', 'user.email', 'test@example.com')
    sh(main, 'config', 'user.name', 'test')
    writeFileSync(join(main, 'a.txt'), 'a\n')
    sh(main, 'add', '.')
    sh(main, 'commit', '-q', '-m', 'first')
    first = sh(main, 'rev-parse', 'HEAD')
    writeFileSync(join(main, 'a.txt'), 'b\n')
    sh(main, 'commit', '-q', '-am', 'second')
    second = sh(main, 'rev-parse', 'HEAD')
    slot = join(root, 'app-s1')
    sh(main, 'worktree', 'add', '-q', '--detach', slot, first)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('allows a slot with no marker, keeps the marker out of the working tree, and forgets it on release', () => {
    expect(refusalOf({ dir: slot, owner: 'b', now })).toBeUndefined()
    writeOwner(slot, { owner: 'a', commit: first, now })
    expect(existsSync(ownerMarkerPath(slot))).toBe(true)
    expect(sh(slot, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    clearOwner(slot)
    expect(existsSync(ownerMarkerPath(slot))).toBe(false)
  })

  it('refuses another owner within two hours, naming the owner, the commit and the age', () => {
    writeOwner(slot, { owner: 'a', commit: first, now: now - 30 * MINUTE_MS })
    const reason = refusalOf({ dir: slot, owner: 'b', now })
    expect(reason).toContain('held by a')
    expect(reason).toContain(first.slice(0, 7))
    expect(reason).toContain('30 min')
  })

  it('has no check for the same owner, nor for an owner whose marker is two hours old', () => {
    sh(slot, 'checkout', '-q', '--detach', second)
    expect(refusalOf({ dir: slot, owner: 'a', now })).toBeUndefined()
    writeOwner(slot, { owner: 'a', commit: second, now: now - 3 * HOUR_MS })
    expect(refusalOf({ dir: slot, owner: 'b', now })).toBeUndefined()
  })

  it('refuses a slot moved by a plain git checkout outside jig, naming the reflog entry', () => {
    writeOwner(slot, { owner: 'a', commit: first, now: now - 3 * HOUR_MS })
    const reason = refusalOf({ dir: slot, owner: 'b', now })
    expect(reason).toMatch(/HEAD@\{0\}: checkout: moving from [0-9a-f]+ to [0-9a-f]+ \(/)
    expect(refusalOf({ dir: slot, owner: 'b', now: now + 3 * HOUR_MS })).toBeUndefined()
  })
})
