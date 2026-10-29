import { readdirSync, rmdirSync, unlinkSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { git } from '../core/git'

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
}

/**
 * Deletes a linked worktree: its links and junctions first, so a seeded `node_modules` junction or a
 * recreated symlink can never take the main checkout's files with it, then `git worktree remove --force`.
 */
export const removeLinkedWorktree = (path: string, mainRoot: string): Removal => {
  let unlinked: number
  try {
    unlinked = unlinkLinks(path).length
  } catch (error) {
    return { unlinked: 0, error: `could not unlink the links in ${path}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const result = git(['worktree', 'remove', '--force', path], mainRoot)
  return { unlinked, error: result.ok ? undefined : result.stderr.trim() }
}
