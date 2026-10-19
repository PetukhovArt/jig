import { spawnSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { git, gitToplevel } from '../core/git'
import { toSlash } from '../core/paths'
import { findInPath } from '../core/proc'
import { slotNumber } from '../slot/slot'
import { samePath, type Worktree } from './list'

export type Bucket = 'hold-current' | 'hold-locked' | 'hold-wip' | 'hold-open-mr' | 'prunable' | 'recent' | 'safe'

export interface SweepRow {
  bucket: Bucket
  slot: number | null
  path: string
  branch: string | null
}

/** Removing one of these would lose uncommitted work or pull a checkout from under a live session. */
export const KEPT_BUCKETS: ReadonlySet<Bucket> = new Set(['hold-current', 'hold-locked', 'hold-wip'])

const RECENT_MS = 24 * 60 * 60 * 1000
const MS_PER_SECOND = 1000
const SLOT_ITEM = /^s?(\d+)$/

const runJson = (bin: string, args: string[], cwd: string): unknown => {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return undefined
  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    return undefined
  }
}

const branchNames = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: Record<string, unknown>) => (typeof item[field] === 'string' ? [item[field]] : []))
}

export const openMrBranches = (cwd: string): Set<string> => {
  const remote = git(['remote', 'get-url', 'origin'], cwd).stdout
  const isGithub = remote.includes('github.com')
  const tool = isGithub ? findInPath('gh') : findInPath('glab')
  if (tool === undefined) return new Set()
  const branches = isGithub
    ? branchNames(runJson(tool, ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'headRefName'], cwd), 'headRefName')
    : branchNames(runJson(tool, ['mr', 'list', '--per-page', '100', '--output', 'json'], cwd), 'source_branch')
  return new Set(branches)
}

const isRecent = (path: string, now: number): boolean => {
  const result = git(['log', '-1', '--format=%ct'], path)
  const committedAt = Number(result.stdout.trim()) * MS_PER_SECOND
  return result.ok && now - committedAt < RECENT_MS
}

export interface SweepScope {
  mainRoot: string
  repo: string
  current: string | undefined
  openBranches: ReadonlySet<string>
  now: number
}

const bucketOf = (worktree: Worktree, scope: SweepScope): Bucket => {
  if (worktree.isPrunable) return 'prunable'
  if (scope.current !== undefined && samePath(worktree.path, scope.current)) return 'hold-current'
  if (worktree.isLocked) return 'hold-locked'
  const status = git(['status', '--porcelain=v1'], worktree.path)
  if (!status.ok || status.stdout.trim() !== '') return 'hold-wip'
  if (worktree.branch !== undefined && scope.openBranches.has(worktree.branch)) return 'hold-open-mr'
  return isRecent(worktree.path, scope.now) ? 'recent' : 'safe'
}

export const auditWorktrees = (worktrees: readonly Worktree[], scope: SweepScope): SweepRow[] =>
  worktrees
    .filter((worktree) => !samePath(worktree.path, scope.mainRoot))
    .map((worktree) => ({
      bucket: bucketOf(worktree, scope),
      slot: slotNumber(basename(worktree.path), scope.repo) ?? null,
      path: toSlash(worktree.path),
      branch: worktree.branch ?? null,
    }))

export const currentWorktree = (cwd: string): string | undefined => gitToplevel(cwd)

/** Rows named by `--yes` items: a slot number (`3`, `s3`) or a worktree path relative to `cwd`. */
export const matchItems = (rows: readonly SweepRow[], items: readonly string[], cwd: string): { rows: SweepRow[]; unknown: string[] } => {
  const matched: SweepRow[] = []
  const unknown: string[] = []
  for (const item of items) {
    const slot = SLOT_ITEM.exec(item)?.[1]
    const row = rows.find((candidate) =>
      slot === undefined ? samePath(candidate.path, resolve(cwd, item)) : candidate.slot === Number(slot),
    )
    if (row === undefined) {
      unknown.push(item)
    } else if (!matched.includes(row)) {
      matched.push(row)
    }
  }
  return { rows: matched, unknown }
}

export const removeWorktree = (row: SweepRow, mainRoot: string): string | undefined => {
  const result =
    row.bucket === 'prunable' ? git(['worktree', 'prune'], mainRoot) : git(['worktree', 'remove', '--force', row.path], mainRoot)
  return result.ok ? undefined : result.stderr.trim()
}

export const formatRow = (row: SweepRow): string =>
  `${row.bucket}  ${row.path}  ${row.branch ?? '(detached)'}${row.slot === null ? '' : `  slot ${row.slot}`}`
