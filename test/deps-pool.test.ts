import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { formatDeps, provideDeps, type DepsOutcome } from '../src/worktree/deps-pool'
import { samePath } from '../src/worktree/list'
import { removeLinkedWorktree } from '../src/worktree/remove'

const canSymlink = ((): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'jig-link-probe-'))
  try {
    writeFileSync(join(dir, 'target'), '')
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})()

const INSTALL = [
  "const fs = require('fs')",
  "const path = require('path')",
  'const root = process.cwd()',
  "if (fs.existsSync('race.json')) {",
  "  const race = JSON.parse(fs.readFileSync('race.json', 'utf8'))",
  '  fs.renameSync(race.from, race.to)',
  '}',
  "fs.writeFileSync('install.marker', '')",
  "fs.mkdirSync(path.join('node_modules', 'pkg', 'lib'), { recursive: true })",
  "fs.writeFileSync(path.join('node_modules', 'pkg', 'lib', 'index.js'), 'installed')",
  "fs.writeFileSync(path.join('node_modules', '.package-lock.json'), '{}')",
  "fs.mkdirSync(path.join('packages', 'ws', 'node_modules', 'dep'), { recursive: true })",
  "fs.writeFileSync(path.join('packages', 'ws', 'node_modules', 'dep', 'index.js'), 'dep')",
  "fs.mkdirSync(path.join('packages', 'ws', 'dist'), { recursive: true })",
  "fs.writeFileSync(path.join('packages', 'ws', 'dist', 'out.js'), 'built')",
  "const ws = path.join('node_modules', 'ws')",
  "if (process.platform === 'win32') fs.symlinkSync(path.join(root, 'packages', 'ws'), ws, 'junction')",
  "else fs.symlinkSync(path.join('..', 'packages', 'ws'), ws, 'dir')",
  'try {',
  "  fs.mkdirSync(path.join('node_modules', '.bin'))",
  "  fs.symlinkSync(path.join('..', 'pkg', 'lib', 'index.js'), path.join('node_modules', '.bin', 'tool'), 'file')",
  '} catch {}',
].join('\n')

const AFTER = [
  "const fs = require('fs')",
  "fs.writeFileSync('after.marker', '')",
  "fs.mkdirSync('packages/ws/dist', { recursive: true })",
  "fs.writeFileSync('packages/ws/dist/out.js', 'after')",
].join('\n')

const options = (main: string, install = 'node install.cjs') => ({ main, install, after: 'node after.cjs' })

const keyOf = (outcome: DepsOutcome): string | undefined => ('key' in outcome ? outcome.key : undefined)

const inode = (path: string): bigint => statSync(path, { bigint: true }).ino

describe('dependency pool', () => {
  let root: string
  let main: string
  let pool: string
  let firstKey: string | undefined

  const sh = (cwd: string, ...args: string[]): void => {
    const result = git(args, cwd)
    if (!result.ok) throw new Error(result.stderr)
  }

  const worktree = (name: string): string => {
    const dir = join(root, name)
    sh(main, 'worktree', 'add', '-q', '--detach', dir, 'main')
    return dir
  }

  const entries = (): string[] => (existsSync(pool) ? readdirSync(pool) : [])

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-deps-pool-')))
    main = join(root, 'main')
    pool = join(main, '.git', 'jig', 'deps')
    sh(root, 'init', '-q', '-b', 'main', main)
    sh(main, 'config', 'user.email', 'test@example.com')
    sh(main, 'config', 'user.name', 'test')
    writeFileSync(join(main, '.gitignore'), ['node_modules/', 'dist/', '*.marker', '.jig/', 'race.json', ''].join('\n'))
    writeFileSync(join(main, 'package-lock.json'), '{"lockfileVersion":3}')
    writeFileSync(join(main, 'install.cjs'), INSTALL)
    writeFileSync(join(main, 'after.cjs'), AFTER)
    writeFileSync(join(main, 'fail.cjs'), 'process.exit(3)')
    mkdirSync(join(main, 'packages', 'ws'), { recursive: true })
    writeFileSync(join(main, 'packages', 'ws', 'package.json'), '{"name":"ws"}')
    sh(main, 'add', '.')
    sh(main, 'commit', '-q', '-m', 'init')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('installs on a miss, pools the dependency folders and reports what else the install made', () => {
    const first = worktree('a')
    const outcome = provideDeps(first, options(main))
    firstKey = keyOf(outcome)

    expect(outcome).toMatchObject({ kind: 'installed', pooled: true, lockfile: 'package-lock.json', footprint: ['install.marker', 'packages/ws/dist/'] })
    expect(existsSync(join(first, 'after.marker'))).toBe(false)
    expect(readFileSync(join(pool, firstKey ?? '', 'node_modules', 'pkg', 'lib', 'index.js'), 'utf8')).toBe('installed')
    expect(readFileSync(join(pool, firstKey ?? '', 'packages', 'ws', 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('dep')
  })

  it('reuses the entry in the next worktree as hardlinks without installing, then runs after', () => {
    const second = worktree('b')
    const outcome = provideDeps(second, options(main))
    const pooledFile = join(pool, firstKey ?? '', 'node_modules', 'pkg', 'lib', 'index.js')
    const file = join(second, 'node_modules', 'pkg', 'lib', 'index.js')
    const rootFile = join('node_modules', '.package-lock.json')

    expect(outcome).toMatchObject({ kind: 'reused', key: firstKey, transfer: 'hardlink' })
    expect(existsSync(join(second, 'install.marker'))).toBe(false)
    expect(existsSync(join(second, 'after.marker'))).toBe(true)
    expect(inode(file)).toBe(inode(pooledFile))
    expect(statSync(file).nlink).toBeGreaterThan(1)
    expect(inode(join(second, rootFile))).not.toBe(inode(join(pool, firstKey ?? '', rootFile)))
    expect(readFileSync(join(second, 'packages', 'ws', 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('dep')
  })

  it('re-points a workspace link of the installing worktree at the reusing one', () => {
    const link = join(root, 'b', 'node_modules', 'ws')

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(samePath(realpathSync.native(link), join(root, 'b', 'packages', 'ws'))).toBe(true)
  })

  it.skipIf(!canSymlink)('re-points a link between packages inside the dependency folder', () => {
    const second = join(root, 'b')

    expect(samePath(readlinkSync(join(second, 'node_modules', '.bin', 'tool')), join(second, 'node_modules', 'pkg', 'lib', 'index.js'))).toBe(true)
  })

  it('makes a new entry when the lock file changes and asks for after when it is not set', () => {
    const third = worktree('c')
    writeFileSync(join(third, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}')
    const outcome = provideDeps(third, { main, install: 'node install.cjs' })

    expect(outcome).toMatchObject({ kind: 'installed', pooled: true })
    expect(keyOf(outcome)).not.toBe(firstKey)
    expect(formatDeps(outcome).join('\n')).toContain('set worktree.depsPool.after')
  })

  it('skips a lock file whose package manager has no dependency folder to pool', () => {
    const fourth = worktree('d')
    rmSync(join(fourth, 'package-lock.json'))
    writeFileSync(join(fourth, 'uv.lock'), '')

    expect(provideDeps(fourth, options(main))).toEqual({ kind: 'skipped', reason: 'uv.lock has no dependency folder that jig pools' })
  })

  it('fails on a failed install and pools nothing', () => {
    const fifth = worktree('e')
    const before = entries()
    const outcome = provideDeps(fifth, options(main, 'node fail.cjs'))

    expect(outcome).toEqual({ kind: 'failed', detail: 'install node fail.cjs failed (exit 3)' })
    expect(entries()).toEqual(before)
  })

  it('keeps the entry another run published first and removes its own staging copy', () => {
    const sixth = worktree('f')
    const key = firstKey ?? ''
    const rival = join(pool, 'rival')
    renameSync(join(pool, key), rival)
    writeFileSync(join(rival, 'node_modules', 'rival.txt'), 'theirs')
    writeFileSync(join(sixth, 'race.json'), JSON.stringify({ from: rival, to: join(pool, key) }))
    const outcome = provideDeps(sixth, options(main))

    expect(outcome).toMatchObject({ kind: 'installed', pooled: true, key })
    expect(readFileSync(join(pool, key, 'node_modules', 'rival.txt'), 'utf8')).toBe('theirs')
    expect(entries().filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the pool intact when a reusing worktree is removed', () => {
    const removal = removeLinkedWorktree(join(root, 'b'), main)

    expect(removal.error).toBeUndefined()
    expect(existsSync(join(root, 'b'))).toBe(false)
    expect(readFileSync(join(pool, firstKey ?? '', 'node_modules', 'pkg', 'lib', 'index.js'), 'utf8')).toBe('installed')
  })
})
