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
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { LOCKFILES, type Lockfile } from '../catalog'
import { git } from '../core/git'
import { isAlive } from '../core/proc'
import { unlinkLinks, unlinkOne } from './remove'
import { createLink, ignoredEntries, linkTarget } from './seed'

export interface DepsOptions {
  main: string
  install?: string | undefined
  after?: string | undefined
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
  | ({ kind: 'reused' } & Pooled)
  | ({ kind: 'installed'; pooled: true } & Pooled)
  | { kind: 'installed'; pooled: false; lockfile: string; key: string; reason: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; detail: string }

type PooledLockfile = Lockfile & { deps: string }

interface Manifest {
  lockfile: string
  deps: string[]
  footprint: string[]
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

const runCommand =(command: string, dir: string): number | null =>
  spawnSync(command, { cwd: dir, shell: true, windowsHide: true, stdio: ['ignore', 2, 2] }).status

const isPooled = (lockfile: Lockfile): lockfile is PooledLockfile => lockfile.deps !== undefined

const findLockfile = (worktree: string): PooledLockfile | string => {
  const present = LOCKFILES.filter((lockfile) => existsSync(join(worktree, lockfile.file)))
  const pooled = present.find(isPooled)
  if (pooled !== undefined) return pooled
  const [first] = present
  return first === undefined ? 'no lock file at the worktree root' : `${first.file} has no dependency folder that jig pools`
}

const keyOf = (worktree: string, lockfile: PooledLockfile, install: string): string => {
  const hash = createHash('sha256')
  for (const part of [lockfile.file, readFileSync(join(worktree, lockfile.file)), install, process.platform, process.arch]) {
    hash.update(part).update('\0')
  }
  hash.update(`node${process.versions.node.split('.')[0] ?? ''}`)
  return hash.digest('hex').slice(0, KEY_HEX_CHARS)
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

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
  return { lockfile, deps, footprint }
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

const sweepStaging = (pool: string): void => {
  for (const name of readdirSync(pool)) {
    const pid = STAGING.exec(name)?.[1]
    if (pid !== undefined && !isAlive(Number(pid))) removeTree(join(pool, name))
  }
}

const publish = (staging: string, entry: string): void => {
  try {
    renameSync(staging, entry)
  } catch (error) {
    if (!existsSync(join(entry, MANIFEST))) throw error
    removeTree(staging)
  }
}

const reuse = (worktree: string, entry: string, manifest: Manifest, key: string, after: string | undefined): DepsOutcome => {
  const copier: Copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, entry, worktree), transfer: 'hardlink', files: 0 }
  for (const dir of manifest.deps) {
    const destination = join(worktree, dir)
    if (!existsSync(dirname(destination))) continue
    removeTree(destination)
    copyTree(join(entry, dir), destination, copier, true)
  }
  if (after !== undefined) {
    const status = runCommand(after, worktree)
    if (status !== 0) return { kind: 'failed', detail: `after command ${after} failed (exit ${status})` }
  }
  const { files, transfer } = copier
  return { kind: 'reused', lockfile: manifest.lockfile, key, files, transfer, after, footprint: manifest.footprint }
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
  mkdirSync(pool, { recursive: true })
  sweepStaging(pool)
  const entry = join(realpathSync.native(pool), key)
  const staging = join(pool, `${key}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`)
  const copier: Copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, worktree, entry), transfer: 'hardlink', files: 0 }
  try {
    for (const dir of deps) {
      copyTree(join(worktree, dir), join(staging, dir), copier, true)
    }
    const manifest: Manifest = { lockfile: lockfile.file, deps, footprint }
    writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
    publish(staging, entry)
  } catch (error) {
    removeTree(staging)
    return notPooled(`could not pool: ${messageOf(error)}`)
  }
  const { files, transfer } = copier
  return { kind: 'installed', pooled: true, lockfile: lockfile.file, key, files, transfer, after, footprint }
}

/**
 * Fills the dependency folders of `worktree` (`node_modules` of npm and yarn) from the dependency
 * pool in the repository's git common dir (`.git/jig/deps`), out of reach of IDE indexers, watchers
 * and globs. A pool entry is keyed by the lock file, the install command, the platform, the CPU
 * architecture and the Node major version. On a hit the folders are replaced by a hardlink copy of
 * the entry (copies across volumes) and `after` runs in the worktree; on a miss the install command
 * (`install`, else the lock file's own) runs there and its result becomes the entry. Commands print
 * to stderr. A failed install, reuse copy or `after` comes back as `failed`; a failed pooling after a
 * good install comes back as `installed` with `pooled: false`, the worktree still usable.
 */
export const provideDeps = (worktree: string, options: DepsOptions): DepsOutcome => {
  const lockfile = findLockfile(worktree)
  if (typeof lockfile === 'string') return { kind: 'skipped', reason: lockfile }
  const install = options.install ?? lockfile.install
  try {
    const key = keyOf(worktree, lockfile, install)
    const pool = poolOf(options.main)
    const entry = join(pool, key)
    if (!existsSync(entry)) return installAndPool(worktree, pool, key, lockfile, install, options.after)
    const manifestPath = join(entry, MANIFEST)
    const manifest = existsSync(manifestPath) ? parseManifest(readFileSync(manifestPath, 'utf8')) : undefined
    if (manifest === undefined) return { kind: 'failed', detail: `pool entry ${entry} has no valid ${MANIFEST}: delete the entry` }
    return reuse(worktree, realpathSync.native(entry), manifest, key, options.after)
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

export const formatDeps = (outcome: DepsOutcome): string[] => {
  switch (outcome.kind) {
    case 'reused':
      return [
        `deps: reused pool entry ${outcome.key} for ${outcome.lockfile} (${outcome.files} files)${outcome.after === undefined ? '' : `, ran ${outcome.after}`}`,
        ...pooledLines(outcome),
      ]
    case 'installed':
      if (!outcome.pooled) return [`deps: installed for ${outcome.lockfile}, not pooled: ${outcome.reason}`]
      return [`deps: installed for ${outcome.lockfile}, pooled as ${outcome.key} (${outcome.files} files)`, ...pooledLines(outcome)]
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
