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
  files: number
  transfer: FileTransfer
  after: string | undefined
  footprint: string[]
}

export type DepsOutcome =
  | ({ kind: 'reused'; from: string | undefined } & Pooled)
  | ({ kind: 'installed'; pooled: true } & Pooled)
  | { kind: 'installed'; pooled: false; lockfile: string; key: string; reason: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; detail: string }

export type SaveOutcome =
  | ({ kind: 'saved' } & Pooled)
  | { kind: 'kept'; lockfile: string; key: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; detail: string }

export type PruneOutcome =
  | { kind: 'pruned'; dryRun: boolean; entries: string[]; staging: string[]; copied: string[] }
  | { kind: 'failed'; detail: string }

type PooledLockfile = Lockfile & { deps: string }

type Freshness = 'fresh' | 'stale' | 'unknown'

interface Manifest {
  lockfile: string
  deps: string[]
  footprint: string[]
  transfer: FileTransfer | undefined
}

interface Copier {
  retarget: (raw: string, linkDir: string) => string
  transfer: FileTransfer
  files: number
}

const POOL_DIR = 'deps'
const MANIFEST = 'jig-deps.json'
const KEY_HEX_CHARS = 16
const STAGING = /^[0-9a-f]+\.(\d+)-[0-9a-f]+\.tmp$/

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const codeOf = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

const poolOf = (main: string): string => {
  const common = git(['rev-parse', '--git-common-dir'], main)
  if (!common.ok) throw new Error(`git rev-parse --git-common-dir in ${main} failed: ${common.stderr.trim()}`)
  return join(resolve(main, common.stdout.trim()), 'jig', POOL_DIR)
}

const runCommand = (command: string, dir: string): number | null =>
  spawnSync(command, { cwd: dir, shell: true, windowsHide: true, stdio: ['ignore', 2, 2] }).status

const isPooled = (lockfile: Lockfile): lockfile is PooledLockfile => lockfile.deps !== undefined

const findLockfile = (checkout: string): PooledLockfile | string => {
  const present = LOCKFILES.filter((lockfile) => existsSync(join(checkout, lockfile.file)))
  const pooled = present.find(isPooled)
  if (pooled !== undefined) return pooled
  const [first] = present
  return first === undefined ? 'no lock file at the worktree root' : `${first.file} has no dependency folder that jig pools`
}

const keyOf = (checkout: string, lockfile: PooledLockfile, install: string): string => {
  const manifest = lockfile.manifest === undefined ? undefined : join(checkout, lockfile.manifest)
  const manifestBytes = manifest !== undefined && existsSync(manifest) ? readFileSync(manifest) : ''
  const hash = createHash('sha256')
  for (const part of [lockfile.file, readFileSync(join(checkout, lockfile.file)), manifestBytes, install, process.platform, process.arch]) {
    hash.update(part).update('\0')
  }
  hash.update(`node${process.versions.node.split('.')[0] ?? ''}`)
  return hash.digest('hex').slice(0, KEY_HEX_CHARS)
}

const mtimeOf = (path: string): number | undefined => lstatSync(path, { throwIfNoEntry: false })?.mtimeMs

const freshnessOf = (checkout: string, lockfile: PooledLockfile): Freshness => {
  if (lockfile.stamp === undefined) return 'unknown'
  const locked = mtimeOf(join(checkout, lockfile.file)) ?? Infinity
  return lockfile.stamp.some((stamp) => (mtimeOf(join(checkout, stamp)) ?? -Infinity) >= locked) ? 'fresh' : 'stale'
}

const hasDepsDir = (checkout: string, lockfile: PooledLockfile): boolean =>
  lstatSync(join(checkout, lockfile.deps), { throwIfNoEntry: false })?.isDirectory() === true

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
  return { lockfile, deps, footprint, transfer }
}

const readManifest = (entry: string): Manifest | undefined => {
  const path = join(entry, MANIFEST)
  return existsSync(path) ? parseManifest(readFileSync(path, 'utf8')) : undefined
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

const snapshot = (source: string, pool: string, key: string, contents: Omit<Manifest, 'transfer'>): Copier => {
  mkdirSync(pool, { recursive: true })
  for (const name of deadStaging(pool)) {
    removeTree(join(pool, name))
  }
  const entry = join(realpathSync.native(pool), key)
  const staging = join(pool, `${key}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`)
  const copier: Copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, source, entry), transfer: 'hardlink', files: 0 }
  try {
    for (const dir of contents.deps) {
      copyTree(join(source, dir), join(staging, dir), copier, true)
    }
    const manifest: Manifest = { ...contents, transfer: copier.transfer }
    writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
    publish(staging, entry)
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

const reuse = (worktree: string, pooledEntry: string, lockfile: PooledLockfile, key: string, after: string | undefined, from: string | undefined): DepsOutcome => {
  const manifest = readManifest(pooledEntry)
  if (manifest === undefined) return { kind: 'failed', detail: `pool entry ${pooledEntry} has no valid ${MANIFEST}: delete the entry` }
  const entry = realpathSync.native(pooledEntry)
  const copier: Copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, entry, worktree), transfer: 'hardlink', files: 0 }
  for (const dir of manifest.deps) {
    const destination = join(worktree, dir)
    if (!existsSync(dirname(destination))) continue
    removeTree(destination)
    copyTree(join(entry, dir), destination, copier, true)
  }
  touchStamps(worktree, lockfile.stamp ?? [])
  if (after !== undefined) {
    const status = runCommand(after, worktree)
    if (status !== 0) return { kind: 'failed', detail: `after command ${after} failed (exit ${status})` }
  }
  const { files, transfer } = copier
  return { kind: 'reused', from, lockfile: manifest.lockfile, key, files, transfer, after, footprint: manifest.footprint }
}

const installedCheckout = (target: string, main: string, key: string, install: string): { path: string; deps: string[] } | undefined => {
  for (const checkout of listWorktrees(main)) {
    if (checkout.isPrunable || samePath(checkout.path, target)) continue
    const lockfile = findLockfile(checkout.path)
    if (typeof lockfile === 'string' || keyOf(checkout.path, lockfile, install) !== key) continue
    if (freshnessOf(checkout.path, lockfile) !== 'fresh' || !hasDepsDir(checkout.path, lockfile)) continue
    const deps = depsDirsOf(ignoredEntries(checkout.path), lockfile.deps)
    if (deps.length > 0) return { path: checkout.path, deps }
  }
  return undefined
}

const poolFromCheckout = (source: { path: string; deps: string[] }, pool: string, key: string, lockfile: PooledLockfile): boolean => {
  try {
    snapshot(source.path, pool, key, { lockfile: lockfile.file, deps: source.deps, footprint: [] })
    return true
  } catch (error) {
    process.stderr.write(`deps: could not pool the dependencies of ${toSlash(source.path)}, installing instead: ${messageOf(error)}\n`)
    return false
  }
}

const installAndPool = (
  worktree: string,
  pool: string,
  key: string,
  lockfile: PooledLockfile,
  install: string,
  after: string | undefined,
): DepsOutcome => {
  const before = ignoredEntries(worktree)
  unlinkDepsLinks(worktree, lockfile.deps, before)
  const status = runCommand(install, worktree)
  if (status !== 0) return { kind: 'failed', detail: `install ${install} failed (exit ${status})` }
  const entries = ignoredEntries(worktree)
  const deps = depsDirsOf(entries, lockfile.deps)
  const notPooled = (reason: string): DepsOutcome => ({ kind: 'installed', pooled: false, lockfile: lockfile.file, key, reason })
  if (deps.length === 0) return notPooled(`install left no ${lockfile.deps} folder`)
  const known = new Set(before)
  const footprint = entries.filter((entry) => !known.has(entry) && !deps.some((dir) => entry === `${dir}/` || entry.startsWith(`${dir}/`)))
  let copier: Copier
  try {
    copier = snapshot(worktree, pool, key, { lockfile: lockfile.file, deps, footprint })
  } catch (error) {
    return notPooled(`could not pool: ${messageOf(error)}`)
  }
  const { files, transfer } = copier
  return { kind: 'installed', pooled: true, lockfile: lockfile.file, key, files, transfer, after, footprint }
}

/**
 * Fills the dependency folders of `checkout` (`node_modules` of npm and yarn; a linked worktree or the
 * main checkout) from the dependency pool in the repository's git common dir (`.git/jig/deps`), out
 * of reach of IDE indexers, watchers and globs. A pool entry is keyed by the lock file, the manifest
 * (`package.json`), the install command, the platform, the CPU architecture and the Node major
 * version. On a hit the folders are replaced by a hardlink copy of the entry (copies across volumes)
 * and `after` runs in the checkout. On a miss, another checkout of the repository with the same key
 * and a fresh install (its install stamp no older than its lock file) becomes the entry and is reused
 * (`from` names it); without one the install command (`install`, else the lock file's own) runs in
 * `checkout` and its result becomes the entry. Commands print to stderr. A failed install, reuse copy
 * or `after` comes back as `failed`; a failed pooling after a good install comes back as `installed`
 * with `pooled: false`, the checkout still usable.
 */
export const provideDeps = (checkout: string, options: DepsOptions): DepsOutcome => {
  const lockfile = findLockfile(checkout)
  if (typeof lockfile === 'string') return { kind: 'skipped', reason: lockfile }
  const install = options.install ?? lockfile.install
  try {
    const key = keyOf(checkout, lockfile, install)
    const pool = poolOf(options.main)
    const entry = join(pool, key)
    if (existsSync(entry)) return reuse(checkout, entry, lockfile, key, options.after, undefined)
    const source = installedCheckout(checkout, options.main, key, install)
    if (source !== undefined && poolFromCheckout(source, pool, key, lockfile)) {
      return reuse(checkout, entry, lockfile, key, options.after, toSlash(source.path))
    }
    return installAndPool(checkout, pool, key, lockfile, install, options.after)
  } catch (error) {
    return { kind: 'failed', detail: messageOf(error) }
  }
}

/**
 * Makes the dependency folders `checkout` has now the pool entry for its key, without an install:
 * its files become hardlinks shared with the entry. An existing entry is kept as is (`kept`). Fails
 * when the root dependency folder is missing or a link, or when it looks older than the lock file
 * (the install stamp is older) or its age is unknown (no stamp for the lock file), unless `force`.
 */
export const saveDeps = (checkout: string, options: SaveOptions): SaveOutcome => {
  const lockfile = findLockfile(checkout)
  if (typeof lockfile === 'string') return { kind: 'skipped', reason: lockfile }
  const install = options.install ?? lockfile.install
  try {
    const key = keyOf(checkout, lockfile, install)
    const pool = poolOf(options.main)
    if (existsSync(join(pool, key))) return { kind: 'kept', lockfile: lockfile.file, key }
    if (!hasDepsDir(checkout, lockfile)) return { kind: 'failed', detail: `${toSlash(checkout)} has no ${lockfile.deps} folder of its own` }
    const freshness = freshnessOf(checkout, lockfile)
    if (freshness !== 'fresh' && options.force !== true) {
      const why =
        freshness === 'stale'
          ? `${lockfile.deps} looks older than ${lockfile.file} (${(lockfile.stamp ?? []).join(' or ')} is older): install first`
          : `jig knows no install stamp for ${lockfile.file}, so it cannot tell whether ${lockfile.deps} matches it`
      return { kind: 'failed', detail: `${why}, or pass --force` }
    }
    const deps = depsDirsOf(ignoredEntries(checkout), lockfile.deps)
    const { files, transfer } = snapshot(checkout, pool, key, { lockfile: lockfile.file, deps, footprint: [] })
    return { kind: 'saved', lockfile: lockfile.file, key, files, transfer, after: undefined, footprint: [] }
  } catch (error) {
    return { kind: 'failed', detail: messageOf(error) }
  }
}

/**
 * Removes the pool entries no checkout uses (no file of theirs has another hardlink) and the staging
 * folders of dead runs; with `dryRun` only lists them. An entry whose files were copied
 * (`transfer: copy`) has no hardlinks to count, so it is kept and listed in `copied`.
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

export const formatDeps = (outcome: DepsOutcome | SaveOutcome): string[] => {
  switch (outcome.kind) {
    case 'reused':
      if (outcome.from !== undefined) {
        return [
          `deps: pooled the installed ${outcome.lockfile} dependencies of ${outcome.from} as ${outcome.key}, reused them (${outcome.files} files)${ranAfter(outcome.after)}`,
          ...pooledLines(outcome),
        ]
      }
      return [`deps: reused pool entry ${outcome.key} for ${outcome.lockfile} (${outcome.files} files)${ranAfter(outcome.after)}`, ...pooledLines(outcome)]
    case 'installed':
      if (!outcome.pooled) return [`deps: installed for ${outcome.lockfile}, not pooled: ${outcome.reason}`]
      return [`deps: installed for ${outcome.lockfile}, pooled as ${outcome.key} (${outcome.files} files)`, ...pooledLines(outcome)]
    case 'saved':
      return [`deps: saved the dependencies for ${outcome.lockfile} as pool entry ${outcome.key} (${outcome.files} files)`, ...pooledLines(outcome)]
    case 'kept':
      return [`deps: pool entry ${outcome.key} for ${outcome.lockfile} already exists, kept as is`]
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
