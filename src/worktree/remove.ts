import { existsSync, readdirSync, rmdirSync, unlinkSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { git } from '../core/git'
import { listWorktrees, samePath } from './list'

const entriesOf = (dir: string): Dirent[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export const unlinkOne = (path: string): void => {
  try {
    unlinkSync(path)
  } catch (error) {
    const isDirectoryLink = error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EISDIR')
    if (!isDirectoryLink) throw error
    rmdirSync(path)
  }
}

/**
 * Removes every symlink and junction under `dir` (the links themselves, never their targets) and
 * returns their paths. Directories behind a link are not entered; `.git` is left alone.
 */
export const unlinkLinks = (dir: string): string[] => {
  const removed: string[] = []
  for (const entry of entriesOf(dir)) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      unlinkOne(path)
      removed.push(path)
    } else if (entry.isDirectory() && entry.name !== '.git') {
      removed.push(...unlinkLinks(path))
    }
  }
  return removed
}

export interface Removal {
  unlinked: number
  error: string | undefined
  /** Set when git unregistered the worktree but its top folder is still on disk (a process holds it, on Windows). */
  leftover: string | undefined
}

const RMDIR_ATTEMPTS = 5
const RMDIR_DELAY_MS = 200

const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Deletes `dir` only while it is empty, retrying briefly while a process still holds it; a message when it stays, undefined when it is gone. */
export const removeEmptyDir = (dir: string, delayMs = RMDIR_DELAY_MS): string | undefined => {
  let failure = ''
  for (let attempt = 0; attempt < RMDIR_ATTEMPTS; attempt += 1) {
    if (!existsSync(dir)) return undefined
    try {
      rmdirSync(dir)
      return undefined
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') return undefined
      failure = error instanceof Error ? error.message : String(error)
      if (code === 'ENOTEMPTY' || code === 'ENOTDIR') break
      if (attempt < RMDIR_ATTEMPTS - 1) pause(delayMs)
    }
  }
  return `${dir} is still on disk and could not be deleted (a shell, editor or indexer may hold it: close it, then delete the folder): ${failure}`
}

const isRegistered = (path: string, mainRoot: string): boolean => {
  try {
    return listWorktrees(mainRoot).some((worktree) => samePath(worktree.path, path))
  } catch {
    return true
  }
}

/**
 * Deletes a linked worktree: its links and junctions first, so a seeded `node_modules` junction or a
 * recreated symlink can never take the main checkout's files with it, then `git worktree remove --force`.
 * On Windows git exits 255 with `failed to delete '<dir>': Permission denied` when a process holds the
 * folder, after it unregistered the worktree and deleted the contents: the empty top folder is then deleted
 * here (retried briefly), and `leftover` says so when it cannot be.
 */
export const removeLinkedWorktree = (path: string, mainRoot: string): Removal => {
  let unlinked: number
  try {
    unlinked = unlinkLinks(path).length
  } catch (error) {
    return { unlinked: 0, error: `could not unlink the links in ${path}: ${error instanceof Error ? error.message : String(error)}`, leftover: undefined }
  }
  const result = git(['worktree', 'remove', '--force', path], mainRoot)
  if (!result.ok && isRegistered(path, mainRoot)) return { unlinked, error: result.stderr.trim(), leftover: undefined }
  return { unlinked, error: undefined, leftover: removeEmptyDir(path) }
}
