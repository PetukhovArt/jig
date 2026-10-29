import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { git } from '../core/git'

export interface Worktree {
  path: string
  branch?: string
  isPrunable: boolean
  isLocked: boolean
}

export const parseWorktreeList = (porcelain: string): Worktree[] => {
  const worktrees: Worktree[] = []
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    const pathLine = lines.find((line) => line.startsWith('worktree '))
    if (pathLine === undefined) continue
    const branchLine = lines.find((line) => line.startsWith('branch '))
    const hasFlag = (flag: string): boolean => lines.some((line) => line === flag || line.startsWith(`${flag} `))
    const worktree: Worktree = {
      path: resolve(pathLine.slice('worktree '.length)),
      isPrunable: hasFlag('prunable'),
      isLocked: hasFlag('locked'),
    }
    if (branchLine !== undefined) {
      worktree.branch = branchLine.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
    worktrees.push(worktree)
  }
  return worktrees
}

export const listWorktrees = (cwd: string): Worktree[] => {
  const result = git(['worktree', 'list', '--porcelain'], cwd)
  if (!result.ok) throw new Error(`git worktree list failed: ${result.stderr.trim()}`)
  return parseWorktreeList(result.stdout)
}

const LINKED_GITDIR = /^gitdir:\s*(.+)$/m

/** The root of the linked worktree that holds `dir`, found by stat calls up the tree: undefined in a main checkout, a submodule or outside git. */
export const linkedWorktreeRoot = (dir: string): string | undefined => {
  for (let current = resolve(dir); ; current = dirname(current)) {
    const dotGit = join(current, '.git')
    const stats = lstatSync(dotGit, { throwIfNoEntry: false })
    if (stats?.isFile() === true) {
      const gitdir = LINKED_GITDIR.exec(readFileSync(dotGit, 'utf8'))?.[1] ?? ''
      return /[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(gitdir.trim()) ? current : undefined
    }
    if (stats !== undefined || dirname(current) === current) return undefined
  }
}

const canonical = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** Compares two absolute paths after resolving links; on Windows also ignoring case and slash style. */
export const samePath = (left: string, right: string, platform: NodeJS.Platform = process.platform): boolean => {
  const normalize = (path: string): string => {
    const slashed = canonical(path).replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'win32' ? slashed.toLowerCase() : slashed
  }
  return normalize(left) === normalize(right)
}
