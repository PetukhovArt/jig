import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { samePath } from '../src/worktree/list'
import { installSteps } from '../src/worktree/lockfiles'
import { removeLinkedWorktree } from '../src/worktree/remove'
import { excluder, formatSeed, linkTarget, seedWorktree } from '../src/worktree/seed'

const identity = (path: string): string => path

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

describe('link target', () => {
  it.each([
    ['relative link inside main, Windows', '..\\shared\\skill', 'C:\\repo\\.claude\\skills', 'D:\\wt\\repo-s1\\.claude\\shared\\skill'],
    ['absolute link inside main, Windows', 'C:\\repo\\docs\\a.md', 'C:\\repo', 'D:\\wt\\repo-s1\\docs\\a.md'],
    ['drive letter case differs', 'c:\\REPO\\docs\\a.md', 'C:\\repo', 'D:\\wt\\repo-s1\\docs\\a.md'],
    ['forward slashes', 'C:/repo/docs/a.md', 'C:\\repo', 'D:\\wt\\repo-s1\\docs\\a.md'],
    ['outside main stays', 'D:\\configs\\skill', 'C:\\repo\\.claude\\skills', 'D:\\configs\\skill'],
    ['sibling with main as name prefix stays', 'C:\\repo-other\\x', 'C:\\repo', 'C:\\repo-other\\x'],
    ['other drive stays', 'E:\\repo\\x', 'C:\\repo', 'E:\\repo\\x'],
    ['relative link leaving main becomes absolute', '..\\..\\shared', 'C:\\repo\\a', 'C:\\shared'],
  ])('%s', (_name, raw, linkDir, expected) => {
    expect(linkTarget(raw, linkDir, 'C:\\repo', 'D:\\wt\\repo-s1', win32, identity)).toBe(expected)
  })

  it('works on POSIX paths', () => {
    expect(linkTarget('../b', '/home/u/repo/a', '/home/u/repo', '/tmp/wt', posix, identity)).toBe('/tmp/wt/b')
    expect(linkTarget('/opt/shared', '/home/u/repo', '/home/u/repo', '/tmp/wt', posix, identity)).toBe('/opt/shared')
  })
})

describe('same path', () => {
  it('ignores case, slash style and a trailing slash on Windows only', () => {
    expect(samePath('C:\\Repo\\Wt\\', 'c:/repo/wt', 'win32')).toBe(true)
    expect(samePath('C:\\Repo', 'C:\\Repo2', 'win32')).toBe(false)
    expect(samePath('/home/u/Repo', '/home/u/repo', 'linux')).toBe(false)
  })
})

describe('seedExclude', () => {
  it('drops the matched path and everything under it', () => {
    const isExcluded = excluder(['.idea', '**/*.log'])
    expect(isExcluded('.idea/workspace.xml')).toBe(true)
    expect(isExcluded('.idea/')).toBe(true)
    expect(isExcluded('logs/debug.log')).toBe(true)
    expect(isExcluded('.env')).toBe(false)
  })

  it('reads Windows separators', () => {
    expect(excluder(['secrets/**'])('secrets\\prod.env')).toBe(true)
  })
})

describe('install after a lock file change', () => {
  it('picks the package manager from the lock file name and runs it where the lock file is', () => {
    expect(installSteps(['web/package-lock.json', 'src/a.ts', 'pnpm-lock.yaml'], undefined)).toEqual([
      { dir: 'web', command: 'npm ci' },
      { dir: '.', command: 'pnpm install --frozen-lockfile' },
    ])
  })

  it('reads Windows separators and deduplicates', () => {
    expect(installSteps(['api\\uv.lock', 'api/uv.lock'], undefined)).toEqual([{ dir: 'api', command: 'uv sync --frozen' }])
  })

  it('prefers the configured install command, once, at the root', () => {
    expect(installSteps(['a/yarn.lock', 'b/yarn.lock'], 'make deps')).toEqual([{ dir: '.', command: 'make deps' }])
  })

  it('does nothing when no lock file changed', () => {
    expect(installSteps(['package.json', 'src/package-lock.json.md'], 'npm ci')).toEqual([])
  })
})

describe('seed a worktree from the main checkout', () => {
  let root: string
  let main: string
  let worktree: string
  let shared: string

  const sh = (cwd: string, ...args: string[]): string => {
    const result = git(args, cwd)
    if (!result.ok) throw new Error(result.stderr)
    return result.stdout
  }

  const read = (...parts: string[]): string => readFileSync(join(worktree, ...parts), 'utf8')

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'jig-seed-'))
    main = join(root, 'main')
    worktree = join(root, 'wt')
    shared = join(root, 'shared-skill')
    mkdirSync(shared)
    writeFileSync(join(shared, 'SKILL.md'), 'shared')
    sh(root, 'init', '-q', '-b', 'main', main)
    sh(main, 'config', 'user.email', 'test@example.com')
    sh(main, 'config', 'user.name', 'test')
    writeFileSync(
      join(main, '.gitignore'),
      ['.env*', 'node_modules/', '.claude/skills/', 'config.local', '*.log', 'link-*', 'cache/', ''].join('\n'),
    )
    mkdirSync(join(main, 'docs'))
    writeFileSync(join(main, 'docs', 'readme.md'), 'main docs')
    sh(main, 'add', '.')
    sh(main, 'commit', '-q', '-m', 'init')
    sh(main, 'checkout', '-q', '-b', 'feat')
    writeFileSync(join(main, 'config.local'), 'branch')
    sh(main, 'add', '-f', 'config.local')
    sh(main, 'commit', '-q', '-m', 'track config.local')
    sh(main, 'checkout', '-q', 'main')

    writeFileSync(join(main, 'config.local'), 'main')
    writeFileSync(join(main, '.env'), 'SECRET=1\n')
    mkdirSync(join(main, 'src'))
    writeFileSync(join(main, 'src', 'keep.ts'), '')
    sh(main, 'add', 'src/keep.ts')
    sh(main, 'commit', '-q', '-m', 'src')
    writeFileSync(join(main, 'src', '.env.dev'), 'NESTED=1\n')
    writeFileSync(join(main, 'debug.log'), 'noise')
    mkdirSync(join(main, 'node_modules', 'pkg', 'nested'), { recursive: true })
    writeFileSync(join(main, 'node_modules', 'pkg', 'index.js'), '')
    mkdirSync(join(main, 'cache'))
    writeFileSync(join(main, 'cache', 'keep.json'), '{"warm":true}')
    mkdirSync(join(main, '.claude', 'skills'), { recursive: true })
    if (canSymlink) {
      symlinkSync(shared, join(main, '.claude', 'skills', 'linked'), 'dir')
      symlinkSync(join('docs', 'readme.md'), join(main, 'link-docs'), 'file')
      symlinkSync(join(shared, 'SKILL.md'), join(main, 'node_modules', 'outside-link'), 'file')
    }
    appendFileSync(join(main, '.git', 'info', 'exclude'), '.jig/\n')
    mkdirSync(join(main, '.jig', 'cache'), { recursive: true })
    writeFileSync(join(main, '.jig', 'config.jsonc'), '{"rules":{}}')
    writeFileSync(join(main, '.jig', 'review.jsonc'), '{"maxParallel":2}')
    writeFileSync(join(main, '.jig', 'cache', 'plan.json'), '{}')
    sh(main, 'worktree', 'add', '-q', worktree, 'feat')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('copies ignored files, keeps tracked ones, skips folders and excluded paths', () => {
    const items = seedWorktree(main, worktree, { seedExclude: ['*.log'], copyFiles: ['cache/keep.json', '.env', 'docs/readme.md'] })

    expect(read('.env')).toBe('SECRET=1\n')
    expect(read('src', '.env.dev')).toBe('NESTED=1\n')
    expect(read('config.local')).toBe('branch')
    expect(read('cache', 'keep.json')).toBe('{"warm":true}')
    expect(() => lstatSync(join(worktree, 'debug.log'))).toThrow()
    expect(() => lstatSync(join(worktree, 'node_modules', 'pkg'))).toThrow()
    expect(items).toContainEqual({ action: 'kept', path: 'config.local' })
    expect(items).toContainEqual({ action: 'excluded', path: 'debug.log' })
    expect(items).toContainEqual({ action: 'skipped', path: '.env', detail: 'seeded anyway, drop it from copyFiles' })
    expect(items).toContainEqual({
      action: 'skipped',
      path: 'docs/readme.md',
      detail: 'copyFiles takes only files inside an ignored folder',
    })
    expect(items.filter((item) => item.action === 'failed')).toEqual([])
    expect(formatSeed(items).at(-1)).toMatch(/^seed: \d+ copied, \d+ linked, 1 kept, 1 excluded, 0 failed$/)
  })

  it('never overwrites on a second run', () => {
    writeFileSync(join(worktree, '.env'), 'EDITED=1\n')
    const items = seedWorktree(main, worktree, { seedExclude: ['*.log'] })

    expect(read('.env')).toBe('EDITED=1\n')
    expect(items.filter((item) => item.action === 'copied' || item.action === 'linked')).toEqual([])
  })

  it.skipIf(!canSymlink)('recreates ignored symlinks, also those inside a folder ignored in full', () => {
    const skill = join(worktree, '.claude', 'skills', 'linked')
    const docs = join(worktree, 'link-docs')

    expect(lstatSync(skill).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('shared')
    expect(lstatSync(docs).isSymbolicLink()).toBe(true)
    expect(samePath(readlinkSync(docs), join(worktree, 'docs', 'readme.md'))).toBe(true)
    expect(lstatSync(join(worktree, 'node_modules', 'outside-link')).isSymbolicLink()).toBe(true)
  })

  it("copies jig's project config out of a .jig folder ignored in full, not its cache", () => {
    const items = seedWorktree(main, worktree)

    expect(read('.jig', 'config.jsonc')).toBe('{"rules":{}}')
    expect(read('.jig', 'review.jsonc')).toBe('{"maxParallel":2}')
    expect(() => lstatSync(join(worktree, '.jig', 'cache'))).toThrow()
    expect(items.filter((item) => item.path.startsWith('.jig/') && item.action !== 'kept' && item.action !== 'copied')).toEqual([])
  })
})

describe('worktree teardown', () => {
  let root: string
  let main: string
  let worktree: string

  const sh = (cwd: string, ...args: string[]): void => {
    const result = git(args, cwd)
    if (!result.ok) throw new Error(result.stderr)
  }

  const sentinel = (): string => join(main, 'node_modules', 'pkg', 'sentinel.txt')

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'jig-deps-'))
    main = join(root, 'main')
    worktree = join(root, 'wt')
    sh(root, 'init', '-q', '-b', 'main', main)
    sh(main, 'config', 'user.email', 'test@example.com')
    sh(main, 'config', 'user.name', 'test')
    writeFileSync(join(main, '.gitignore'), 'node_modules/\n')
    sh(main, 'add', '.')
    sh(main, 'commit', '-q', '-m', 'init')
    mkdirSync(join(main, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(sentinel(), 'installed')
    sh(main, 'worktree', 'add', '-q', '--detach', worktree, 'main')
    symlinkSync(join(main, 'node_modules'), join(worktree, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('unlinks a junction or symlink first, so the main checkout keeps its node_modules', () => {
    expect(lstatSync(join(worktree, 'node_modules')).isSymbolicLink()).toBe(true)
    const removal = removeLinkedWorktree(worktree, main)
    expect(removal).toEqual({ unlinked: 1, error: undefined })
    expect(existsSync(worktree)).toBe(false)
    expect(readFileSync(sentinel(), 'utf8')).toBe('installed')
  })
})
