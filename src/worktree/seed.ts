import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync } from 'node:fs'
import nodePath, { type PlatformPath } from 'node:path'
import { git } from '../core/git'
import { createMatcher } from '../core/glob'

export interface SeedOptions {
  seedExclude?: readonly string[]
  copyFiles?: readonly string[]
}

export type SeedAction = 'copied' | 'linked' | 'kept' | 'excluded' | 'skipped' | 'failed'

export interface SeedItem {
  action: SeedAction
  path: string
  detail?: string
}

const exists = (path: string): boolean => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

const canonicalOrRaw = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

const relativeInside = (api: PlatformPath, root: string, path: string): string | undefined => {
  const rel = api.relative(root, path)
  if (rel === '..' || rel.startsWith(`..${api.sep}`) || api.isAbsolute(rel)) return undefined
  return rel
}

/**
 * Where the worktree's copy of a symlink points. A target inside the main checkout is re-pointed at
 * the worktree's own copy, so the link never edits the other checkout; any other target stays,
 * made absolute, because the worktree sits at another depth than main.
 */
export const linkTarget = (
  raw: string,
  linkDir: string,
  main: string,
  worktree: string,
  api: PlatformPath = nodePath,
  canonical: (path: string) => string = canonicalOrRaw,
): string => {
  const absolute = canonical(api.isAbsolute(raw) ? api.normalize(raw) : api.resolve(linkDir, raw))
  const inside = relativeInside(api, canonical(main), absolute)
  return inside === undefined ? absolute : api.join(worktree, inside)
}

/** Ignored paths of `main`; `--directory` reports a folder ignored in full as one `dir/` entry. */
export const ignoredEntries = (main: string): string[] => {
  const result = git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], main)
  if (!result.ok) throw new Error(`git ls-files in ${main} failed: ${result.stderr.trim()}`)
  return result.stdout.split('\0').filter(Boolean)
}

/** A `seedExclude` glob drops the path it matches and everything under it. */
export const excluder = (globs: readonly string[]): ((path: string) => boolean) => {
  const matches = createMatcher(globs)
  return (path) => {
    const parts = path.replace(/\\/g, '/').replace(/\/$/, '').split('/')
    return parts.some((_part, index) => matches(parts.slice(0, index + 1).join('/')))
  }
}

const symlinkType = (source: string): 'dir' | 'file' => {
  try {
    return statSync(source).isDirectory() ? 'dir' : 'file'
  } catch {
    return 'file'
  }
}

const isPermissionError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EPERM'

const createLink = (source: string, target: string, destination: string): void => {
  const type = symlinkType(source)
  try {
    symlinkSync(target, destination, type)
  } catch (error) {
    const canUseJunction = process.platform === 'win32' && type === 'dir' && isPermissionError(error)
    if (!canUseJunction) throw error
    symlinkSync(target, destination, 'junction')
  }
}

const place = (main: string, worktree: string, rel: string): SeedItem => {
  const source = nodePath.join(main, rel)
  const destination = nodePath.join(worktree, rel)
  const path = rel.replace(/\\/g, '/')
  if (exists(destination)) return { action: 'kept', path }
  try {
    const stats = lstatSync(source)
    if (!stats.isSymbolicLink() && !stats.isFile()) return { action: 'skipped', path, detail: 'not a file' }
    mkdirSync(nodePath.dirname(destination), { recursive: true })
    if (stats.isFile()) {
      copyFileSync(source, destination)
      return { action: 'copied', path }
    }
    const target = linkTarget(readlinkSync(source), nodePath.dirname(source), main, worktree)
    createLink(source, target, destination)
    return { action: 'linked', path, detail: target.replace(/\\/g, '/') }
  } catch (error) {
    return { action: 'failed', path, detail: error instanceof Error ? error.message : String(error) }
  }
}

const linksInside = (main: string, dir: string): string[] => {
  try {
    return readdirSync(nodePath.join(main, dir), { withFileTypes: true })
      .filter((entry) => entry.isSymbolicLink())
      .map((entry) => `${dir}${entry.name}`)
  } catch {
    return []
  }
}

const copyFileItem = (
  main: string,
  worktree: string,
  file: string,
  ignoredDirs: readonly string[],
  files: ReadonlySet<string>,
): SeedItem => {
  const path = nodePath.posix.normalize(file.replace(/\\/g, '/'))
  if (nodePath.isAbsolute(file) || path === '..' || path.startsWith('../')) {
    return { action: 'failed', path, detail: 'copyFiles path leaves the repository' }
  }
  if (files.has(path)) return { action: 'skipped', path, detail: 'seeded anyway, drop it from copyFiles' }
  if (!ignoredDirs.some((dir) => path.startsWith(dir))) {
    return { action: 'skipped', path, detail: 'copyFiles takes only files inside an ignored folder' }
  }
  return place(main, worktree, path)
}

/**
 * Fills a fresh `worktree` with what `git worktree add` leaves behind: the gitignored files of
 * `main` are copied and its gitignored symlinks recreated, including the links sitting directly in a
 * folder ignored in full. Ignored folders themselves are not copied, and nothing already present
 * (a file the branch tracks) is overwritten. Best effort: one failed item is reported, not thrown.
 * Behaviour ported from pacer `crates/pacer-daemon/src/worktree_seed.rs`.
 */
export const seedWorktree = (main: string, worktree: string, options: SeedOptions = {}): SeedItem[] => {
  const isExcluded = excluder(options.seedExclude ?? [])
  const entries = ignoredEntries(main)
  const ignoredDirs = entries.filter((entry) => entry.endsWith('/'))
  const files = entries.filter((entry) => !entry.endsWith('/'))
  const candidates = [...files, ...ignoredDirs.filter((dir) => !isExcluded(dir)).flatMap((dir) => linksInside(main, dir))]
  const items = candidates.map((rel): SeedItem => (isExcluded(rel) ? { action: 'excluded', path: rel } : place(main, worktree, rel)))
  const fileSet = new Set(files)
  for (const file of options.copyFiles ?? []) {
    items.push(copyFileItem(main, worktree, file, ignoredDirs, fileSet))
  }
  return items
}

export const NODE_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'] as const
export const DEPS_DIR = 'node_modules'

const readOrUndefined = (path: string): Buffer | undefined => {
  try {
    return readFileSync(path)
  } catch {
    return undefined
  }
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const BINARY_LOCKFILES: ReadonlySet<string> = new Set(['bun.lockb'])

const lockBytes = (dir: string, file: string): string | undefined => {
  const bytes = readOrUndefined(nodePath.join(dir, file))
  if (bytes === undefined) return undefined
  const text = bytes.toString('latin1')
  return BINARY_LOCKFILES.has(file) ? text : text.replace(/\r\n/g, '\n')
}

const lockMismatch = (main: string, worktree: string): string | undefined => {
  const pairs = NODE_LOCKFILES.map((file) => ({ file, main: lockBytes(main, file), worktree: lockBytes(worktree, file) }))
  const present = pairs.filter((pair) => pair.main !== undefined || pair.worktree !== undefined)
  if (present.length === 0) return 'no lock file'
  const differs = present.find((pair) => pair.main === undefined || pair.worktree === undefined || pair.main !== pair.worktree)
  return differs === undefined ? undefined : `${differs.file} differs from the main checkout`
}

/**
 * Links the worktree's `node_modules` to the main checkout's (a junction on Windows, a symlink
 * elsewhere) only when every root lock file is byte-identical in both (CRLF read as LF in a text
 * lock file: `core.autocrlf` checks one out with CRLF while npm writes LF), so the installed tree
 * is the one the worktree's lock file describes. Otherwise nothing is created and the item says why.
 */
export const linkDependencies = (main: string, worktree: string): SeedItem => {
  const source = nodePath.join(main, DEPS_DIR)
  const destination = nodePath.join(worktree, DEPS_DIR)
  if (exists(destination)) return { action: 'kept', path: DEPS_DIR }
  if (!isDirectory(source)) return { action: 'skipped', path: DEPS_DIR, detail: 'the main checkout has none' }
  const mismatch = lockMismatch(main, worktree)
  if (mismatch !== undefined) return { action: 'skipped', path: DEPS_DIR, detail: mismatch }
  try {
    symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
    return { action: 'linked', path: DEPS_DIR, detail: source.replace(/\\/g, '/') }
  } catch (error) {
    return { action: 'failed', path: DEPS_DIR, detail: error instanceof Error ? error.message : String(error) }
  }
}

export const formatSeed =(items: readonly SeedItem[]): string[] => {
  const lines = items
    .filter((item) => item.action !== 'kept' && item.action !== 'excluded')
    .map((item) => `${item.action} ${item.path}${item.detail === undefined ? '' : ` (${item.detail})`}`)
  const count = (action: SeedAction): number => items.filter((item) => item.action === action).length
  lines.push(
    `seed: ${count('copied')} copied, ${count('linked')} linked, ${count('kept')} kept, ${count('excluded')} excluded, ${count('failed')} failed`,
  )
  return lines
}
