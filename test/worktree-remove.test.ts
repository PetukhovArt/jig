import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listWorktrees } from '../src/worktree/list'
import { removeEmptyDir, removeLinkedWorktree } from '../src/worktree/remove'

let root: string
let main: string
let worktree: string
let holder: ChildProcess | undefined

const sh = (cwd: string, ...args: string[]): void => {
  expect(spawnSync('git', args, { cwd }).status).toBe(0)
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-worktree-remove-')))
  main = join(root, 'main')
  worktree = join(root, 'wt')
  mkdirSync(main)
  sh(main, 'init', '-q')
  sh(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  sh(main, 'worktree', 'add', '-q', '--detach', worktree)
})

afterEach(() => {
  holder?.kill()
  holder = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('removeLinkedWorktree: a process holds the folder', () => {
  it('unregisters the worktree and reports the folder it could not delete, or leaves none', async () => {
    holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: worktree, stdio: 'ignore' })
    await new Promise((resolve) => holder?.once('spawn', resolve))

    const removal = removeLinkedWorktree(worktree, main)

    expect(removal.error).toBeUndefined()
    expect(listWorktrees(main).map((entry) => entry.path)).not.toContain(worktree)
    if (existsSync(worktree)) {
      expect(removal.leftover).toContain('could not be deleted')
      holder.kill()
      await new Promise((resolve) => holder?.once('exit', resolve))
      expect(removeEmptyDir(worktree)).toBeUndefined()
    } else {
      expect(removal.leftover).toBeUndefined()
    }
    expect(existsSync(worktree)).toBe(false)
  })
})

describe('removeEmptyDir', () => {
  it('never deletes a folder that has files in it', () => {
    mkdirSync(join(root, 'full'))
    writeFileSync(join(root, 'full', 'keep.txt'), 'x')
    expect(removeEmptyDir(join(root, 'full'), 1)).toContain('could not be deleted')
    expect(existsSync(join(root, 'full', 'keep.txt'))).toBe(true)
  })
})
