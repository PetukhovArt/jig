import { existsSync, readFileSync } from 'node:fs'
import { git } from '../core/git'
import type { FileStat } from './review-plan'

export interface ReviewedState {
  base_sha?: string
  last_reviewed_sha?: string
  diff_hash?: string
}

export interface Rename {
  from: string
  to: string
}

export type RereviewScope =
  | { kind: 'unchanged'; hash: string; files: FileStat[]; total: number }
  | { kind: 'patches'; files: FileStat[]; total: number; renamed: Rename[] }
  | { kind: 'full'; reason: string; files: FileStat[]; total: number }

const PATCH = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff']

const gitOut = (root: string, args: string[], input?: string): string => {
  const result = git(args, root, input)
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

/** The hash a state keeps as `diff_hash`, equal to `git diff <range> | git hash-object --stdin`. */
export const diffHash = (root: string, range: string): string => gitOut(root, ['hash-object', '--stdin'], gitOut(root, [...PATCH, range])).trim()

const exists = (root: string, sha: string | undefined): sha is string => sha !== undefined && git(['cat-file', '-e', `${sha}^{commit}`], root).ok

const isClean = (root: string): boolean => gitOut(root, ['status', '--porcelain', '--untracked-files=no']).trim() === ''

const changeLines = (patch: string): string[] =>
  patch.split('\n').filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))

const countOf = (lines: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

const ownChanges = (path: string, before: string, after: string): FileStat => {
  const unmatched = countOf(changeLines(before))
  let added = 0
  for (const line of changeLines(after)) {
    const left = unmatched.get(line) ?? 0
    if (left > 0) unmatched.set(line, left - 1)
    else added++
  }
  const deleted = [...unmatched.values()].reduce((sum, count) => sum + count, 0)
  return { path, added, deleted }
}

const patchOf = (root: string, range: string, ...paths: string[]): string => gitOut(root, [...PATCH, '-M', range, '--', ...paths])

const mergeRequestFiles = (root: string, base: string): string[] =>
  gitOut(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', '-M', '-z', `${base}...HEAD`]).split('\0').filter(Boolean)

const renamesBetween = (root: string, from: string, to: string): Rename[] => {
  const tokens = gitOut(root, ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', '--diff-filter=R', '-z', from, to]).split('\0')
  const renames: Rename[] = []
  for (let index = 0; index + 2 < tokens.length; index += 3) {
    renames.push({ from: tokens[index + 1] ?? '', to: tokens[index + 2] ?? '' })
  }
  return renames
}

/**
 * The re-review's scope against the merge request base `base`: `unchanged` when the diff is the reviewed one and the
 * tree is clean; `patches`, the files whose patch changed since the last review counted by the branch's own changes
 * (a base merged in or a rebase moves no patch, so the base's hunks never count); `full` when the state cannot say.
 */
export const rereviewScope = (root: string, state: ReviewedState, base: string): RereviewScope => {
  const files = mergeRequestFiles(root, base)
  const total = files.length
  const current = `${base}...HEAD`
  const hash = diffHash(root, current)
  if (hash === state.diff_hash && isClean(root)) return { kind: 'unchanged', hash, files: [], total }
  const full = (reason: string): RereviewScope => ({ kind: 'full', reason, files: files.map((path) => ownChanges(path, '', patchOf(root, current, path))), total })
  if (!exists(root, state.base_sha) || !exists(root, state.last_reviewed_sha)) return full('base_sha or last_reviewed_sha is missing locally')
  const reviewed = `${state.base_sha}...${state.last_reviewed_sha}`
  if (diffHash(root, reviewed) !== state.diff_hash) return full('diff_hash does not match base_sha...last_reviewed_sha')
  const fileSet = new Set(files)
  const renamed = renamesBetween(root, state.last_reviewed_sha, 'HEAD').filter((rename) => fileSet.has(rename.to))
  const reviewedPathOf = new Map(renamed.map((rename) => [rename.to, rename.from]))
  const changed = files
    .map((path) => {
      const from = reviewedPathOf.get(path)
      return from === undefined
        ? ownChanges(path, patchOf(root, reviewed, path), patchOf(root, current, path))
        : ownChanges(path, patchOf(root, reviewed, from), patchOf(root, current, from, path))
    })
    .filter((stat) => stat.added + stat.deleted > 0)
  return { kind: 'patches', files: changed, total, renamed }
}

export const readReviewedState = (path: string): ReviewedState => {
  if (!existsSync(path)) throw new Error(`no state at ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as ReviewedState
}
