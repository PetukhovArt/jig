import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { takeSnapshot, turnDiff } from '../src/core/snapshot'

let root: string

const write = (path: string, text: string): void => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}

const commitAll = (): void => {
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-snapshot-'))
  git(['init', '-q'], root)
  write('.gitignore', 'ignored/\n')
  write('src/tracked.ts', 'export const a = 1\n')
  write('src/clean.ts', 'export const b = 1\n')
  write('src/gone.ts', 'export const c = 1\n')
  commitAll()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('turn diff', () => {
  it('skips a human edit made before the turn', () => {
    write('src/tracked.ts', 'export const a = 22\n')
    const snapshot = takeSnapshot(root)
    expect(Object.keys(snapshot)).toEqual(['src/tracked.ts'])
    expect(turnDiff(root, snapshot, []).files).toEqual([])
  })

  it('includes a file written by an edit tool', () => {
    const snapshot = takeSnapshot(root)
    write('src/clean.ts', 'export const b = 22\n')
    expect(turnDiff(root, snapshot, [{ path: 'src/clean.ts' }]).files).toEqual(['src/clean.ts'])
  })

  it('includes files changed through Bash without an edit record', () => {
    const snapshot = takeSnapshot(root)
    write('src/clean.ts', 'export const b = 333\n')
    write('src/new/created.ts', 'export const d = 1\n')
    expect(turnDiff(root, snapshot, []).files).toEqual(['src/clean.ts', 'src/new/created.ts'])
  })

  it('includes a pre-turn dirty file changed again during the turn', () => {
    write('src/tracked.ts', 'export const a = 2\n')
    const snapshot = takeSnapshot(root)
    write('src/tracked.ts', 'export const a = 2000\n')
    expect(turnDiff(root, snapshot, []).files).toEqual(['src/tracked.ts'])
  })

  it('leaves out deleted and ignored files', () => {
    const snapshot = takeSnapshot(root)
    rmSync(join(root, 'src/gone.ts'))
    write('ignored/out.ts', 'x\n')
    expect(turnDiff(root, snapshot, [{ path: 'src/gone.ts' }]).files).toEqual([])
  })

  it('gives the same fingerprint for the same diff and a new one after a change', () => {
    const snapshot = takeSnapshot(root)
    write('src/clean.ts', 'export const b = 4\n')
    const first = turnDiff(root, snapshot, [])
    expect(turnDiff(root, snapshot, []).fingerprint).toBe(first.fingerprint)
    write('src/clean.ts', 'export const b = 44444\n')
    expect(turnDiff(root, snapshot, []).fingerprint).not.toBe(first.fingerprint)
  })

  it('works outside a git repository from edit records only', () => {
    const plain = mkdtempSync(join(tmpdir(), 'jig-plain-'))
    try {
      writeFileSync(join(plain, 'a.ts'), 'x\n')
      expect(takeSnapshot(plain)).toEqual({})
      expect(turnDiff(plain, {}, [{ path: 'a.ts' }]).files).toEqual(['a.ts'])
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
