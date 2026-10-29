import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { formatDeps, prunePool, provideDeps, saveDeps, type DepsOutcome, type SaveOutcome } from '../src/worktree/deps-pool'
import { samePath } from '../src/worktree/list'
import { removeLinkedWorktree } from '../src/worktree/remove'
import { runWorktree } from '../src/worktree/worktree'

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

const keyOf = (outcome: DepsOutcome | SaveOutcome): string | undefined => ('key' in outcome ? outcome.key : undefined)

const inode = (path: string): bigint => statSync(path, { bigint: true }).ino

const PKG_FILE = join('node_modules', 'pkg', 'lib', 'index.js')

const installByHand = (dir: string): void => {
  execFileSync(process.execPath, ['install.cjs'], { cwd: dir })
}

const makeStale = (dir: string): void => {
  const later = new Date(Date.now() + 60_000)
  utimesSync(join(dir, 'package-lock.json'), later, later)
}

const setManifest = (dir: string, name: string): void => {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }))
}

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
    setManifest(main, 'app')
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

  it.each([
    ['lock file', 'c', 'package-lock.json'],
    ['manifest', 'g', 'package.json'],
  ])('makes a new entry when the %s changes and asks for after when it is not set', (_, name, file) => {
    const third = worktree(name)
    writeFileSync(join(third, file), '{"lockfileVersion":3,"changed":true}')
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
    setManifest(fifth, 'e')
    const before = entries()
    const outcome = provideDeps(fifth, options(main, 'node fail.cjs'))

    expect(outcome).toEqual({ kind: 'failed', detail: 'install node fail.cjs failed (exit 3)' })
    expect(entries()).toEqual(before)
  })

  it('keeps the entry another run published first and removes its own staging copy', () => {
    const sixth = worktree('f')
    makeStale(join(root, 'a'))
    makeStale(join(root, 'b'))
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

  it('saves an installed checkout as an entry that shares its files, and keeps an existing entry', () => {
    const dir = worktree('h')
    setManifest(dir, 'h')
    installByHand(dir)
    const saved = saveDeps(dir, { main, install: 'node install.cjs' })

    expect(saved).toMatchObject({ kind: 'saved', transfer: 'hardlink' })
    expect(inode(join(dir, PKG_FILE))).toBe(inode(join(pool, keyOf(saved) ?? '', PKG_FILE)))
    expect(saveDeps(dir, { main, install: 'node install.cjs' })).toEqual({ kind: 'kept', lockfile: 'package-lock.json', key: keyOf(saved) })
  })

  it.each([
    ['an install older than the lock file', 'i', true, 'node_modules looks older than package-lock.json'],
    ['no dependency folder', 'j', false, 'has no node_modules folder'],
  ])('refuses to save %s', (_, name, isInstalled, detail) => {
    const dir = worktree(name)
    setManifest(dir, name)
    if (isInstalled) {
      installByHand(dir)
      makeStale(dir)
    }
    const before = entries()
    const outcome = saveDeps(dir, { main, install: 'node install.cjs' })

    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' ? outcome.detail : '').toContain(detail)
    expect(entries()).toEqual(before)
  })

  it('serves the main checkout from the pool through worktree deps', () => {
    mkdirSync(join(main, '.jig'), { recursive: true })
    writeFileSync(join(main, '.jig', 'config.jsonc'), JSON.stringify({ slots: { worktreesDir: '..', install: 'node install.cjs' } }))
    const printed: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((text) => printed.push(String(text)) > 0)
    let code: number | Promise<number>
    try {
      code = runWorktree(['deps', main])
    } finally {
      write.mockRestore()
    }

    expect(code).toBe(0)
    expect(printed.join('')).toContain(`reused pool entry ${firstKey ?? ''}`)
    expect(inode(join(main, PKG_FILE))).toBe(inode(join(pool, firstKey ?? '', PKG_FILE)))
  })

  it('pools the fresh install of another checkout with the same key instead of installing', () => {
    const installed = worktree('k')
    setManifest(installed, 'k')
    installByHand(installed)
    const dir = worktree('l')
    setManifest(dir, 'k')
    const outcome = provideDeps(dir, options(main))

    expect(outcome).toMatchObject({ kind: 'reused', transfer: 'hardlink' })
    expect(samePath(outcome.kind === 'reused' ? (outcome.from ?? '') : '', installed)).toBe(true)
    expect(existsSync(join(dir, 'install.marker'))).toBe(false)
    expect(inode(join(dir, PKG_FILE))).toBe(inode(join(installed, PKG_FILE)))
  })

  let unusedKey: string | undefined

  it('installs when the other checkout with the same key has a stale install', () => {
    const installed = worktree('m')
    setManifest(installed, 'm')
    installByHand(installed)
    makeStale(installed)
    const dir = worktree('n')
    setManifest(dir, 'm')
    const outcome = provideDeps(dir, options(main))
    unusedKey = keyOf(outcome)

    expect(outcome).toMatchObject({ kind: 'installed', pooled: true })
    expect(existsSync(join(dir, 'install.marker'))).toBe(true)
  })

  it('prunes the entries and dead staging folders no checkout uses, and only lists them on a dry run', () => {
    expect(removeLinkedWorktree(join(root, 'n'), main).error).toBeUndefined()
    const deadStaging = `${firstKey ?? ''}.99999999-abcd1234.tmp`
    mkdirSync(join(pool, deadStaging))
    const before = entries()
    const dryRun = prunePool(main, true)

    expect(dryRun).toMatchObject({ kind: 'pruned', dryRun: true, staging: [deadStaging] })
    expect(dryRun.kind === 'pruned' ? dryRun.entries : []).toContain(unusedKey)
    expect(dryRun.kind === 'pruned' ? dryRun.entries : []).not.toContain(firstKey)
    expect(entries()).toEqual(before)

    prunePool(main, false)

    expect(entries()).not.toContain(unusedKey)
    expect(entries()).not.toContain(deadStaging)
    expect(entries()).toContain(firstKey)
  })

  it('keeps the pool intact when a reusing worktree is removed', () => {
    const removal = removeLinkedWorktree(join(root, 'b'), main)

    expect(removal.error).toBeUndefined()
    expect(existsSync(join(root, 'b'))).toBe(false)
    expect(readFileSync(join(pool, firstKey ?? '', 'node_modules', 'pkg', 'lib', 'index.js'), 'utf8')).toBe('installed')
  })
})

const RESOLVE = [
  "const fs = require('fs')",
  "const path = require('path')",
  "const name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name",
  "fs.writeFileSync('install.marker', '')",
  "fs.writeFileSync('package-lock.json', JSON.stringify({ name, extra: process.argv[2] ?? null }))",
  "fs.mkdirSync(path.join('node_modules', 'pkg'), { recursive: true })",
  "fs.writeFileSync(path.join('node_modules', 'pkg', 'index.js'), name)",
  "fs.writeFileSync(path.join('node_modules', '.package-lock.json'), '{}')",
].join('\n')

describe('dependency pool with a gitignored lock file', () => {
  let root: string
  let main: string
  let pool: string
  let releaseKey: string | undefined
  let releaseLock: string
  let newestVersion: string | undefined

  const resolveOptions = (dir: string) => ({ main: dir, install: 'node resolve.cjs' })

  const sh = (cwd: string, ...args: string[]): void => {
    const result = git(args, cwd)
    if (!result.ok) throw new Error(result.stderr)
  }

  const lockIn = (dir: string): string => readFileSync(join(dir, 'package-lock.json'), 'utf8')

  const versionOf = (outcome: DepsOutcome | SaveOutcome): string | undefined => ('version' in outcome ? outcome.version : undefined)

  const seededWorktree = (name: string, manifest: string): string => {
    const dir = join(root, name)
    sh(main, 'worktree', 'add', '-q', '--detach', dir, 'main')
    writeFileSync(join(dir, 'package-lock.json'), lockIn(main))
    setManifest(dir, manifest)
    return dir
  }

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-deps-ignored-')))
    main = join(root, 'main')
    pool = join(main, '.git', 'jig', 'deps')
    sh(root, 'init', '-q', '-b', 'main', main)
    sh(main, 'config', 'user.email', 'test@example.com')
    sh(main, 'config', 'user.name', 'test')
    writeFileSync(join(main, '.gitignore'), ['node_modules/', 'package-lock.json', '*.marker', ''].join('\n'))
    setManifest(main, 'app')
    writeFileSync(join(main, 'resolve.cjs'), RESOLVE)
    mkdirSync(join(main, 'packages', 'ws'), { recursive: true })
    writeFileSync(join(main, 'packages', 'ws', 'package.json'), '{"name":"ws"}')
    sh(main, 'add', '.')
    sh(main, 'commit', '-q', '-m', 'init')
    execFileSync(process.execPath, ['resolve.cjs', 'main'], { cwd: main })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('installs a release manifest with the resolving command and pools its lock file with the dependencies', () => {
    const release = seededWorktree('release', 'release')
    const outcome = provideDeps(release, resolveOptions(main))
    releaseKey = keyOf(outcome)
    releaseLock = lockIn(release)

    expect(outcome).toMatchObject({ kind: 'installed', pooled: true, install: 'node resolve.cjs' })
    expect(JSON.parse(releaseLock)).toEqual({ name: 'release', extra: null })
    expect(readFileSync(join(pool, `${releaseKey ?? ''}-${versionOf(outcome) ?? ''}`, 'package-lock.json'), 'utf8')).toBe(releaseLock)
  })

  it("gives a release worktree seeded with the main checkout's lock file the release entry and restores the release lock file", () => {
    const dir = seededWorktree('release-2', 'release')
    const outcome = provideDeps(dir, resolveOptions(main))

    expect(outcome).toMatchObject({ kind: 'reused', key: releaseKey, from: undefined })
    expect(lockIn(dir)).toBe(releaseLock)
    expect(existsSync(join(dir, 'install.marker'))).toBe(false)
    expect(formatDeps(outcome).join('\n')).toContain('restored its package-lock.json')
  })

  it.each([
    ['root manifest', 'feature', 'package.json'],
    ['workspace manifest', 'feature-ws', join('packages', 'ws', 'package.json')],
  ])('misses on a changed %s, runs the resolving command and pools the result', (_, name, file) => {
    const dir = seededWorktree(name, 'release')
    writeFileSync(join(dir, file), JSON.stringify({ name }))
    const outcome = provideDeps(dir, resolveOptions(main))

    expect(outcome).toMatchObject({ kind: 'installed', pooled: true })
    expect(keyOf(outcome)).not.toBe(releaseKey)
    expect(existsSync(join(dir, 'install.marker'))).toBe(true)
  })

  it('makes the newer lock file of an installed sibling a new version first, and later worktrees take the newest version', () => {
    const release = join(root, 'release')
    execFileSync(process.execPath, ['resolve.cjs', 'updated'], { cwd: release })
    const updated = lockIn(release)
    const dir = seededWorktree('release-3', 'release')
    const outcome = provideDeps(dir, resolveOptions(main))
    newestVersion = versionOf(outcome)
    const later = seededWorktree('release-4', 'release')
    const laterOutcome = provideDeps(later, resolveOptions(main))

    expect(outcome).toMatchObject({ kind: 'reused', key: releaseKey })
    expect(samePath(outcome.kind === 'reused' ? (outcome.from ?? '') : '', release)).toBe(true)
    expect(lockIn(dir)).toBe(updated)
    expect(readdirSync(pool).filter((name) => name.startsWith(`${releaseKey ?? ''}-`))).toHaveLength(2)
    expect(laterOutcome).toMatchObject({ kind: 'reused', key: releaseKey, version: newestVersion, from: undefined })
    expect(lockIn(later)).toBe(updated)
  })

  it('saves a checkout whose lock file no version holds as a new version, then reports it kept', () => {
    const dir = seededWorktree('release-5', 'release')
    execFileSync(process.execPath, ['resolve.cjs', 'saved'], { cwd: dir })
    const saved = saveDeps(dir, resolveOptions(main))

    expect(saved).toMatchObject({ kind: 'saved', key: releaseKey })
    expect(versionOf(saved)).not.toBe(newestVersion)
    expect(saveDeps(dir, resolveOptions(main))).toEqual({ kind: 'kept', lockfile: 'package-lock.json', key: releaseKey, version: versionOf(saved) })
  })
})
