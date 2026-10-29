import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { LOCKFILES, type Lockfile } from '../catalog'
import { git } from '../core/git'
import { isAlive } from '../core/proc'
import { toSlash } from '../core/paths'
import { listWorktrees, samePath } from './list'
import { unlinkLinks, unlinkOne } from './remove'
import { createLink, ignoredEntries, linkTarget } from './seed'

export interface DepsOptions {
  main: string
  install?: string | undefined
  after?: string | undefined
}

export interface SaveOptions {
  main: string
  install?: string | undefined
  force?: boolean | undefined
}

export type FileTransfer = 'hardlink' | 'copy'

interface Pooled {
  lockfile: string
  key: string
  version: string | undefined
  files: number
  transfer: FileTransfer
  after: string | undefined
  footprint: string[]
}

export type DepsOutcome =
  | ({ kind: 'reused'; from: string | undefined } & Pooled)
  | ({ kind: 'installed'; pooled: true; install: string } & Pooled)
  | { kind: 'installed'; pooled: false; install: string; lockfile: string; key: string; reason: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; detail: string }

export type SaveOutcome =
  | ({ kind: 'saved' } & Pooled)
  | { kind: 'kept'; lockfile: string; key: string; version: string | undefined }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; detail: string }

export type PruneOutcome =
  | { kind: 'pruned'; dryRun: boolean; entries: string[]; staging: string[]; copied: string[] }
  | { kind: 'failed'; detail: string }

export interface Unprovisioned {
  path: string
  deps: string
}

type PooledLockfile = Lockfile & { deps: string; resolve: string }

type Freshness = 'fresh' | 'stale' | 'unknown'

interface Manifest {
  lockfile: string
  deps: string[]
  footprint: string[]
  transfer: FileTransfer | undefined
  lock: string | undefined
  published: number | undefined
}

interface Copier {
  retarget: (raw: string, linkDir: string) => string
  transfer: FileTransfer
  files: number
}

interface Keyed {
  lockfile: PooledLockfile
  install: string
  key: string
  storesLock: boolean
  manifests: string[]
}

interface StoredLock {
  file: string
  bytes: Buffer
}

interface Entry {
  name: string
  version: string | undefined
}

interface EntryContents {
  lockfile: string
  deps: string[]
  footprint: string[]
  lock: StoredLock | undefined
}

interface Source {
  path: string
  deps: string[]
}

const POOL_DIR = 'deps'
const MANIFEST = 'jig-deps.json'
const KEY_HEX_CHARS = 16
const VERSION_HEX_CHARS = 8
const STAGING = /^[0-9a-f-]+\.(\d+)-[0-9a-f]+\.tmp$/

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const codeOf = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

const poolOf = (main: string): string => {
  const common = git(['rev-parse', '--git-common-dir'], main)
  if (!common.ok) throw new Error(`git rev-parse --git-common-dir in ${main} failed: ${common.stderr.trim()}`)
  return join(resolve(main, common.stdout.trim()), 'jig', POOL_DIR)
}

const runCommand = (command: string, dir: string): number | null =>
  spawnSync(command, { cwd: dir, shell: true, windowsHide: true, stdio: ['ignore', 2, 2] }).status

const isPooled = (lockfile: Lockfile): lockfile is PooledLockfile => lockfile.deps !== undefined && lockfile.resolve !== undefined

const findLockfile = (checkout: string): PooledLockfile | string => {
  const present = LOCKFILES.filter((lockfile) => existsSync(join(checkout, lockfile.file)))
  const pooled = present.find(isPooled)
  if (pooled !== undefined) return pooled
  const [first] = present
  return first === undefined ? 'no lock file at the worktree root' : `${first.file} has no dependency folder that jig pools`
}

const digest = (parts: readonly (string | Buffer)[]): string => {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part).update('\0')
  }
  return hash.digest('hex')
}

const runtimeParts = (install: string): string[] => [install, process.platform, process.arch, `node${process.versions.node.split('.')[0] ?? ''}`]

const lockKeyOf = (checkout: string, lockfile: PooledLockfile, install: string): string => {
  const manifest = lockfile.manifest === undefined ? undefined : join(checkout, lockfile.manifest)
  const manifestBytes = manifest !== undefined && existsSync(manifest) ? readFileSync(manifest) : ''
  return digest([lockfile.file, readFileSync(join(checkout, lockfile.file)), manifestBytes, ...runtimeParts(install)]).slice(0, KEY_HEX_CHARS)
}

const trackedManifests = (checkout: string, manifest: string): string[] => {
  const listed = git(['ls-files', '-z', '--', `*${manifest}`], checkout)
  if (!listed.ok) throw new Error(`git ls-files in ${checkout} failed: ${listed.stderr.trim()}`)
  return listed.stdout
    .split('\0')
    .filter((path) => posix.basename(path) === manifest)
    .sort()
}

const manifestsKeyOf = (checkout: string, lockfile: PooledLockfile, install: string, paths: readonly string[]): string => {
  const manifests = paths.flatMap((path) => {
    const absolute = join(checkout, path)
    return [path, existsSync(absolute) ? readFileSync(absolute) : '']
  })
  return digest(['manifests', lockfile.file, ...manifests, ...runtimeParts(install)]).slice(0, KEY_HEX_CHARS)
}

const isIgnored = (checkout: string, file: string): boolean => git(['check-ignore', '-q', file], checkout).ok

const keyedOf = (checkout: string, lockfile: PooledLockfile, configured: string | undefined): Keyed => {
  const storesLock = isIgnored(checkout, lockfile.file)
  const install = configured ?? (storesLock ? lockfile.resolve : lockfile.install)
  if (!storesLock) return { lockfile, install, key: lockKeyOf(checkout, lockfile, install), storesLock, manifests: [] }
  const manifests = lockfile.manifest === undefined ? [] : trackedManifests(checkout, lockfile.manifest)
  return { lockfile, install, key: manifestsKeyOf(checkout, lockfile, install, manifests), storesLock, manifests }
}

const versionOf = (bytes: Buffer): string => digest([bytes]).slice(0, VERSION_HEX_CHARS)

const lockOf = (keyed: Keyed, checkout: string): StoredLock | undefined =>
  keyed.storesLock ? { file: keyed.lockfile.file, bytes: readFileSync(join(checkout, keyed.lockfile.file)) } : undefined

const entryOf = (keyed: Keyed, lock: StoredLock | undefined): Entry => {
  if (lock === undefined) return { name: keyed.key, version: undefined }
  const version = versionOf(lock.bytes)
  return { name: `${keyed.key}-${version}`, version }
}

const mtimeOf = (path: string): number | undefined => lstatSync(path, { throwIfNoEntry: false })?.mtimeMs

const freshnessOf = (checkout: string, keyed: Keyed): Freshness => {
  const { lockfile } = keyed
  if (lockfile.stamp === undefined) return 'unknown'
  const manifests = keyed.manifests.map((path) => mtimeOf(join(checkout, path)) ?? -Infinity)
  const locked = Math.max(mtimeOf(join(checkout, lockfile.file)) ?? Infinity, ...manifests)
  return lockfile.stamp.some((stamp) => (mtimeOf(join(checkout, stamp)) ?? -Infinity) >= locked) ? 'fresh' : 'stale'
}

const hasDepsDir = (checkout: string, deps: string): boolean =>
  lstatSync(join(checkout, deps), { throwIfNoEntry: false })?.isDirectory() === true

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

const isTransfer = (value: unknown): value is FileTransfer => value === 'hardlink' || value === 'copy'

const parseManifest = (text: string): Manifest | undefined => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || !('lockfile' in value) || !('deps' in value) || !('footprint' in value)) return undefined
  const { lockfile, deps, footprint } = value
  if (typeof lockfile !== 'string' || !isStringArray(deps) || !isStringArray(footprint)) return undefined
  const transfer = 'transfer' in value && isTransfer(value.transfer) ? value.transfer : undefined
  const lock = 'lock' in value && typeof value.lock === 'string' ? value.lock : undefined
  const published = 'published' in value && typeof value.published === 'number' ? value.published : undefined
  return { lockfile, deps, footprint, transfer, lock, published }
}

const readManifest = (entry: string): Manifest | undefined => {
  const path = join(entry, MANIFEST)
  return existsSync(path) ? parseManifest(readFileSync(path, 'utf8')) : undefined
}

const versionsOf = (pool: string, key: string): (Entry & { published: number })[] => {
  if (!existsSync(pool)) return []
  const versionName = new RegExp(`^${key}-([0-9a-f]{${VERSION_HEX_CHARS}})$`)
  return readdirSync(pool)
    .flatMap((name) => {
      const version = versionName.exec(name)?.[1]
      const manifest = version === undefined ? undefined : readManifest(join(pool, name))
      return version === undefined || manifest === undefined ? [] : [{ name, version, published: manifest.published ?? 0 }]
    })
    .sort((left, right) => right.published - left.published)
}

const removeTree = (path: string): void => {
  let isLink: boolean
  try {
    isLink = lstatSync(path).isSymbolicLink()
  } catch {
    return
  }
  if (isLink) {
    unlinkOne(path)
    return
  }
  unlinkLinks(path)
  rmSync(path, { recursive: true, force: true })
}

const placeFile = (source: string, destination: string, copier: Copier): void => {
  copier.files++
  if (copier.transfer === 'hardlink') {
    try {
      linkSync(source, destination)
      return
    } catch (error) {
      const code = codeOf(error)
      if (code !== 'EXDEV' && code !== 'EPERM') throw error
      copier.transfer = 'copy'
    }
  }
  copyFileSync(source, destination)
}

const copyTree = (from: string, to: string, copier: Copier, isDepsRoot: boolean): void => {
  mkdirSync(to, { recursive: true })
  const entries = readdirSync(from, { withFileTypes: true })
  for (const entry of entries.filter((candidate) => !candidate.isFile())) {
    const source = join(from, entry.name)
    const destination = join(to, entry.name)
    if (entry.isSymbolicLink()) {
      createLink(source, copier.retarget(readlinkSync(source), from), destination)
    } else if (entry.isDirectory()) {
      copyTree(source, destination, copier, false)
    }
  }
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const source = join(from, entry.name)
    const destination = join(to, entry.name)
    if (isDepsRoot) {
      copyFileSync(source, destination)
      copier.files++
    } else {
      placeFile(source, destination, copier)
    }
  }
}

const hasLinkedFile = (dir: string): boolean =>
  readdirSync(dir, { withFileTypes: true }).some((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return hasLinkedFile(path)
    return entry.isFile() && statSync(path).nlink > 1
  })

const depsDirsOf = (entries: readonly string[], deps: string): string[] => {
  const dirs = entries.filter((entry) => entry.endsWith('/') && posix.basename(entry) === deps).map((entry) => entry.slice(0, -1))
  return dirs.filter((dir) => !dirs.some((other) => dir.startsWith(`${other}/`)))
}

const unlinkDepsLinks = (worktree: string, deps: string, entries: readonly string[]): void => {
  const candidates = new Set([deps, ...entries.filter((entry) => posix.basename(entry) === deps).map((entry) => entry.replace(/\/$/, ''))])
  for (const candidate of candidates) {
    const path = join(worktree, candidate)
    try {
      if (lstatSync(path).isSymbolicLink()) unlinkOne(path)
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw error
    }
  }
}

const deadStaging = (pool: string): string[] =>
  readdirSync(pool).filter((name) => {
    const pid = STAGING.exec(name)?.[1]
    return pid !== undefined && !isAlive(Number(pid))
  })

const publish = (staging: string, entry: string): void => {
  try {
    renameSync(staging, entry)
  } catch (error) {
    if (!existsSync(join(entry, MANIFEST))) throw error
    removeTree(staging)
  }
}

const snapshot = (source: string, pool: string, entry: Entry, contents: EntryContents): Copier => {
  mkdirSync(pool, { recursive: true })
  for (const name of deadStaging(pool)) {
    removeTree(join(pool, name))
  }
  const target = join(realpathSync.native(pool), entry.name)
  const staging = join(pool, `${entry.name}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`)
  const copier: Copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, source, target), transfer: 'hardlink', files: 0 }
  try {
    for (const dir of contents.deps) {
      copyTree(join(source, dir), join(staging, dir), copier, true)
    }
    if (contents.lock !== undefined) writeFileSync(join(staging, contents.lock.file), contents.lock.bytes)
    const manifest: Manifest = {
      lockfile: contents.lockfile,
      deps: contents.deps,
      footprint: contents.footprint,
      transfer: copier.transfer,
      lock: contents.lock?.file,
      published: Date.now(),
    }
    writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
    publish(staging, target)
  } catch (error) {
    removeTree(staging)
    throw error
  }
  return copier
}

const touchStamps = (worktree: string, stamps: readonly string[]): void => {
  const now = new Date()
  for (const stamp of stamps.map((name) => join(worktree, name)).filter((path) => existsSync(path))) {
    utimesSync(stamp, now, now)
  }
}

const reuse = (worktree: string, pool: string, entry: Entry, keyed: Keyed, after: string | undefined, from: string | undefined): DepsOutcome => {
  const pooledEntry = join(pool, entry.name)
  const manifest = readManifest(pooledEntry)
  if (manifest === undefined) return { kind: 'failed', detail: `pool entry ${pooledEntry} has no valid ${MANIFEST}: delete the entry` }
  const real = realpathSync.native(pooledEntry)
  const copier: Copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, real, worktree), transfer: 'hardlink', files: 0 }
  if (manifest.lock !== undefined) copyFileSync(join(real, manifest.lock), join(worktree, manifest.lock))
  for (const dir of manifest.deps) {
    const destination = join(worktree, dir)
    if (!existsSync(dirname(destination))) continue
    removeTree(destination)
    copyTree(join(real, dir), destination, copier, true)
  }
  touchStamps(worktree, keyed.lockfile.stamp ?? [])
  if (after !== undefined) {
    const status = runCommand(after, worktree)
    if (status !== 0) return { kind: 'failed', detail: `after command ${after} failed (exit ${status})` }
  }
  const { files, transfer } = copier
  const { key } = keyed
  return { kind: 'reused', from, lockfile: manifest.lockfile, key, version: entry.version, files, transfer, after, footprint: manifest.footprint }
}

const installedCheckout = (main: string, keyed: Keyed, configured: string | undefined, accepts: (path: string) => boolean): Source | undefined => {
  for (const checkout of listWorktrees(main)) {
    if (checkout.isPrunable || !accepts(checkout.path)) continue
    const lockfile = findLockfile(checkout.path)
    if (typeof lockfile === 'string') continue
    const sibling = keyedOf(checkout.path, lockfile, configured)
    if (sibling.key !== keyed.key || freshnessOf(checkout.path, sibling) !== 'fresh' || !hasDepsDir(checkout.path, lockfile.deps)) continue
    const deps = depsDirsOf(ignoredEntries(checkout.path), lockfile.deps)
    if (deps.length > 0) return { path: checkout.path, deps }
  }
  return undefined
}

const poolFromCheckout = (source: Source, pool: string, keyed: Keyed): Entry | undefined => {
  try {
    const lock = lockOf(keyed, source.path)
    const entry = entryOf(keyed, lock)
    snapshot(source.path, pool, entry, { lockfile: keyed.lockfile.file, deps: source.deps, footprint: [], lock })
    return entry
  } catch (error) {
    process.stderr.write(`deps: could not pool the dependencies of ${toSlash(source.path)}, installing instead: ${messageOf(error)}\n`)
    return undefined
  }
}

const installAndPool = (worktree: string, pool: string, keyed: Keyed, after: string | undefined): DepsOutcome => {
  const { lockfile, install, key } = keyed
  const before = ignoredEntries(worktree)
  unlinkDepsLinks(worktree, lockfile.deps, before)
  const status = runCommand(install, worktree)
  if (status !== 0) return { kind: 'failed', detail: `install ${install} failed (exit ${status})` }
  const entries = ignoredEntries(worktree)
  const deps = depsDirsOf(entries, lockfile.deps)
  const notPooled = (reason: string): DepsOutcome => ({ kind: 'installed', pooled: false, install, lockfile: lockfile.file, key, reason })
  if (deps.length === 0) return notPooled(`install left no ${lockfile.deps} folder`)
  if (keyed.storesLock && !existsSync(join(worktree, lockfile.file))) return notPooled(`install left no ${lockfile.file}`)
  const known = new Set(before)
  const footprint = entries.filter((entry) => !known.has(entry) && !deps.some((dir) => entry === `${dir}/` || entry.startsWith(`${dir}/`)))
  const lock = lockOf(keyed, worktree)
  const entry = entryOf(keyed, lock)
  let copier: Copier
  try {
    copier = snapshot(worktree, pool, entry, { lockfile: lockfile.file, deps, footprint, lock })
  } catch (error) {
    return notPooled(`could not pool: ${messageOf(error)}`)
  }
  const { files, transfer } = copier
  return { kind: 'installed', pooled: true, install, lockfile: lockfile.file, key, version: entry.version, files, transfer, after, footprint }
}

const reuseOrInstall = (
  checkout: string,
  pool: string,
  keyed: Keyed,
  options: DepsOptions,
  accepts: (path: string) => boolean,
  stored: Entry | undefined,
): DepsOutcome => {
  const source = installedCheckout(options.main, keyed, options.install, accepts)
  const pooled = source === undefined ? undefined : poolFromCheckout(source, pool, keyed)
  if (source !== undefined && pooled !== undefined) return reuse(checkout, pool, pooled, keyed, options.after, toSlash(source.path))
  if (stored !== undefined) return reuse(checkout, pool, stored, keyed, options.after, undefined)
  return installAndPool(checkout, pool, keyed, options.after)
}

const provideTracked = (checkout: string, pool: string, keyed: Keyed, options: DepsOptions): DepsOutcome => {
  const entry = entryOf(keyed, undefined)
  if (existsSync(join(pool, entry.name))) return reuse(checkout, pool, entry, keyed, options.after, undefined)
  return reuseOrInstall(checkout, pool, keyed, options, (path) => !samePath(path, checkout), undefined)
}

const provideIgnored = (checkout: string, pool: string, keyed: Keyed, options: DepsOptions): DepsOutcome => {
  const versions = versionsOf(pool, keyed.key)
  const newest = versions[0]?.published ?? -Infinity
  const known = new Set(versions.map((entry) => entry.version))
  const hasNewerLock = (path: string): boolean => {
    const lock = join(path, keyed.lockfile.file)
    return (mtimeOf(lock) ?? -Infinity) > newest && !known.has(versionOf(readFileSync(lock)))
  }
  return reuseOrInstall(checkout, pool, keyed, options, hasNewerLock, versions[0])
}

/**
 * Fills the dependency folders of `checkout` (`node_modules` of npm and yarn; a linked worktree or the
 * main checkout) from the dependency pool in the repository's git common dir (`.git/jig/deps`), out
 * of reach of IDE indexers, watchers and globs. On a hit the folders are replaced by a hardlink copy
 * of the entry (copies across volumes) and `after` runs in the checkout. Commands print to stderr.
 *
 * A tracked lock file keys the entry together with the root manifest (`package.json`), the install
 * command (`install`, else the lock file's own frozen one), the platform, the CPU architecture and
 * the Node major version. On a miss, another checkout of the repository with the same key and a fresh
 * install (its install stamp no older than its lock file) becomes the entry and is reused (`from`
 * names it); without one the install command runs in `checkout` and its result becomes the entry.
 *
 * A gitignored lock file is an output of the install: the key covers every tracked manifest instead
 * of the lock file, the install command defaults to the resolving one (`npm install`), and an entry
 * stores the lock file, which a reuse writes into `checkout`. One key holds versions, one per stored
 * lock file (`version`); a reuse takes the newest. A checkout with the same key, a fresh install and
 * a lock file newer than the newest version and unlike every version (`checkout` itself included)
 * first becomes a new version, the one reused.
 *
 * A failed install, reuse copy or `after` comes back as `failed`; a failed pooling after a good
 * install comes back as `installed` with `pooled: false`, the checkout still usable.
 */
export const provideDeps = (checkout: string, options: DepsOptions): DepsOutcome => {
  const lockfile = findLockfile(checkout)
  if (typeof lockfile === 'string') return { kind: 'skipped', reason: lockfile }
  try {
    const keyed = keyedOf(checkout, lockfile, options.install)
    const pool = poolOf(options.main)
    return keyed.storesLock ? provideIgnored(checkout, pool, keyed, options) : provideTracked(checkout, pool, keyed, options)
  } catch (error) {
    return { kind: 'failed', detail: messageOf(error) }
  }
}

/**
 * Makes the dependency folders `checkout` has now the pool entry for its key, without an install:
 * its files become hardlinks shared with the entry. With a gitignored lock file the entry is a new
 * version of the key holding the checkout's lock file. An entry for the same key (and the same lock
 * file, when gitignored) is kept as is (`kept`). Fails when the root dependency folder is missing or
 * a link, or when it looks older than the lock file (the install stamp is older) or its age is
 * unknown (no stamp for the lock file), unless `force`.
 */
export const saveDeps = (checkout: string, options: SaveOptions): SaveOutcome => {
  const lockfile = findLockfile(checkout)
  if (typeof lockfile === 'string') return { kind: 'skipped', reason: lockfile }
  try {
    const keyed = keyedOf(checkout, lockfile, options.install)
    const pool = poolOf(options.main)
    const lock = lockOf(keyed, checkout)
    const entry = entryOf(keyed, lock)
    const { key } = keyed
    if (existsSync(join(pool, entry.name))) return { kind: 'kept', lockfile: lockfile.file, key, version: entry.version }
    if (!hasDepsDir(checkout, lockfile.deps)) return { kind: 'failed', detail: `${toSlash(checkout)} has no ${lockfile.deps} folder of its own` }
    const freshness = freshnessOf(checkout, keyed)
    if (freshness !== 'fresh' && options.force !== true) {
      const why =
        freshness === 'stale'
          ? `${lockfile.deps} looks older than ${lockfile.file}${keyed.manifests.length === 0 ? '' : ` or a tracked ${lockfile.manifest ?? ''}`} (${(lockfile.stamp ?? []).join(' or ')} is older): install first`
          : `jig knows no install stamp for ${lockfile.file}, so it cannot tell whether ${lockfile.deps} matches it`
      return { kind: 'failed', detail: `${why}, or pass --force` }
    }
    const deps = depsDirsOf(ignoredEntries(checkout), lockfile.deps)
    const { files, transfer } = snapshot(checkout, pool, entry, { lockfile: lockfile.file, deps, footprint: [], lock })
    return { kind: 'saved', lockfile: lockfile.file, key, version: entry.version, files, transfer, after: undefined, footprint: [] }
  } catch (error) {
    return { kind: 'failed', detail: messageOf(error) }
  }
}

/**
 * Removes the pool entries (each version of a key on its own) no checkout uses (no file of theirs
 * has another hardlink) and the staging folders of dead runs; with `dryRun` only lists them. An entry
 * whose files were copied (`transfer: copy`) has no hardlinks to count, so it is kept and listed in
 * `copied`.
 */
export const prunePool = (main: string, dryRun: boolean): PruneOutcome => {
  try {
    const pool = poolOf(main)
    if (!existsSync(pool)) return { kind: 'pruned', dryRun, entries: [], staging: [], copied: [] }
    const staging = deadStaging(pool)
    const keys = readdirSync(pool, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !STAGING.test(entry.name))
    const copied = keys.filter((entry) => readManifest(join(pool, entry.name))?.transfer === 'copy').map((entry) => entry.name)
    const entries = keys.filter((entry) => !copied.includes(entry.name) && !hasLinkedFile(join(pool, entry.name))).map((entry) => entry.name)
    if (!dryRun) {
      for (const name of [...entries, ...staging]) {
        removeTree(join(pool, name))
      }
    }
    return { kind: 'pruned', dryRun, entries, staging, copied }
  } catch (error) {
    return { kind: 'failed', detail: messageOf(error) }
  }
}

/**
 * Whether `changed` (repository paths, as `git diff --name-only` prints them) changes the pool key
 * of `checkout` because its lock file is gitignored: one of them is a manifest (`package.json`) at
 * any depth. Always false for a tracked lock file, whose own change is the signal. Runs one
 * `git check-ignore`.
 */
export const hasIgnoredLockKeyChange = (checkout: string, changed: readonly string[]): boolean => {
  const lockfile = findLockfile(checkout)
  if (typeof lockfile === 'string' || lockfile.manifest === undefined || changed.length === 0) return false
  const { manifest } = lockfile
  return changed.some((path) => posix.basename(toSlash(path)) === manifest) && isIgnored(checkout, lockfile.file)
}

/**
 * The dependency folder `checkout` lacks: it has, at its root, a lock file of a package manager the
 * pool serves (or, without any lock file, that manager's manifest), and that folder is missing or a
 * link such as a junction into another checkout. Stat calls only.
 */
export const missingDepsOf = (checkout: string): string | undefined => {
  const present = LOCKFILES.filter((lockfile) => existsSync(join(checkout, lockfile.file)))
  const candidates =
    present.length > 0 ? present : LOCKFILES.filter((lockfile) => lockfile.manifest !== undefined && existsSync(join(checkout, lockfile.manifest)))
  const deps = candidates.find(isPooled)?.deps
  return deps === undefined || hasDepsDir(checkout, deps) ? undefined : deps
}

/** The linked worktrees of the repository at `dir` (one `git worktree list`) that lack a dependency folder, as `missingDepsOf` tells. */
export const unprovisionedWorktrees = (dir: string): Unprovisioned[] =>
  listWorktrees(dir)
    .slice(1)
    .flatMap((worktree) => {
      const deps = worktree.isPrunable ? undefined : missingDepsOf(worktree.path)
      return deps === undefined ? [] : [{ path: worktree.path, deps }]
    })

const pooledLines = (outcome: Pooled): string[] => {
  const lines: string[] = []
  if (outcome.transfer === 'copy') {
    lines.push('deps: hardlinks failed, files were copied: keep the worktree on the volume of the main checkout')
  }
  if (outcome.footprint.length > 0 && outcome.after === undefined) {
    lines.push(`deps: install also made ${outcome.footprint.join(', ')}, which a reuse does not: set worktree.depsPool.after to the command that makes them`)
  }
  return lines
}

const ranAfter = (after: string | undefined): string => (after === undefined ? '' : `, ran ${after}`)

const entryLabel = (outcome: { key: string; version: string | undefined }): string =>
  outcome.version === undefined ? `pool entry ${outcome.key}` : `pool entry ${outcome.key} version ${outcome.version}`

const restoredLock = (outcome: Pooled): string => (outcome.version === undefined ? '' : `, restored its ${outcome.lockfile}`)

const storedLock = (outcome: Pooled): string => (outcome.version === undefined ? '' : ` along with ${outcome.lockfile}`)

export const formatDeps = (outcome: DepsOutcome | SaveOutcome): string[] => {
  switch (outcome.kind) {
    case 'reused': {
      const counts = `(${outcome.files} files${restoredLock(outcome)})${ranAfter(outcome.after)}`
      const head =
        outcome.from === undefined
          ? `deps: reused ${entryLabel(outcome)} for ${outcome.lockfile} ${counts}`
          : `deps: pooled the installed ${outcome.lockfile} dependencies of ${outcome.from} as ${entryLabel(outcome)}, reused them ${counts}`
      return [head, ...pooledLines(outcome)]
    }
    case 'installed':
      if (!outcome.pooled) return [`deps: installed for ${outcome.lockfile} with ${outcome.install}, not pooled: ${outcome.reason}`]
      return [
        `deps: installed for ${outcome.lockfile} with ${outcome.install}, pooled as ${entryLabel(outcome)}${storedLock(outcome)} (${outcome.files} files)`,
        ...pooledLines(outcome),
      ]
    case 'saved':
      return [`deps: saved the dependencies for ${outcome.lockfile} as ${entryLabel(outcome)}${storedLock(outcome)} (${outcome.files} files)`, ...pooledLines(outcome)]
    case 'kept':
      return [`deps: ${entryLabel(outcome)} for ${outcome.lockfile} already exists, kept as is`]
    case 'skipped':
      return [`deps: not pooled, ${outcome.reason}`]
    case 'failed':
      return [`deps: failed, ${outcome.detail}`]
    default: {
      const unhandled: never = outcome
      return unhandled
    }
  }
}

export const formatPrune = (outcome: PruneOutcome): string[] => {
  if (outcome.kind === 'failed') return [`deps: failed, ${outcome.detail}`]
  const verb = outcome.dryRun ? 'would remove' : 'removed'
  return [
    ...outcome.entries.map((key) => `deps: ${verb} pool entry ${key}`),
    ...outcome.staging.map((name) => `deps: ${verb} staging folder ${name}`),
    ...outcome.copied.map((key) => `deps: kept pool entry ${key}: its files were copied, not hardlinked, so jig cannot tell whether a checkout uses it`),
    `deps: ${verb} ${outcome.entries.length} pool entries`,
  ]
}
