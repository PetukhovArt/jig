import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { foreignUseOf } from '../src/slot/guard'

const HOUR_MS = 60 * 60 * 1000

describe('foreignUseOf: a slot another session is using', () => {
  let root: string
  let slot: string
  let first: string
  let second: string

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

  it('refuses a commit other than the one a checkout moved HEAD to within two hours, naming the reflog entry', async () => {
    expect(await foreignUseOf({ dir: slot, target: second, ports: [] })).toBeUndefined()
    sh(slot, 'checkout', '-q', '--detach', second)
    const reason = await foreignUseOf({ dir: slot, target: first, ports: [] })
    expect(reason).toMatch(/^HEAD@\{0\}: checkout: moving from [0-9a-f]+ to [0-9a-f]+ \(/)
    expect(reason).toContain(second.slice(0, 7))
  })

  it('does not refuse the commit HEAD is already at, nor a checkout older than two hours', async () => {
    expect(await foreignUseOf({ dir: slot, target: second, ports: [] })).toBeUndefined()
    expect(await foreignUseOf({ dir: slot, target: first, ports: [], now: Date.now() + 3 * HOUR_MS })).toBeUndefined()
  })

  it('refuses while a process answers on a slot port, naming it, and not once it is closed', async () => {
    const old = Date.now() + 3 * HOUR_MS
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    expect(await foreignUseOf({ dir: slot, target: first, ports: [port], now: old })).toContain(`port ${port}`)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(await foreignUseOf({ dir: slot, target: first, ports: [port], now: old })).toBeUndefined()
  })
})
