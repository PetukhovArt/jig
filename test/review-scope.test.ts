import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { buildReport } from '../src/review/review-plan'
import { diffHash, rereviewScope } from '../src/review/scope'

let root: string

const sh = (...args: string[]): string => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  if (!result.ok) throw new Error(result.stderr)
  return result.stdout.trim()
}

const lines = (count: number, prefix: string): string => Array.from({ length: count }, (_, index) => `${prefix}${index}`).join('\n')

const commit = (files: Record<string, string>, message: string): string => {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), `${text}\n`)
  sh('add', '-A')
  sh('commit', '-q', '-m', message)
  return sh('rev-parse', 'HEAD')
}

const reviewedState = () => {
  const baseSha = sh('merge-base', 'main', 'HEAD')
  return { base_sha: baseSha, last_reviewed_sha: sh('rev-parse', 'HEAD'), diff_hash: diffHash(root, `${baseSha}...HEAD`) }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-scope-'))
  sh('init', '-q', '-b', 'main')
  commit({ 'a.ts': lines(20, 'a'), 'b.ts': lines(5, 'b') }, 'base')
  sh('checkout', '-q', '-b', 'feature')
  commit({ 'a.ts': `${lines(20, 'a')}\nfeature`, 'b.ts': `${lines(5, 'b')}\nfeature` }, 'feature work')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('re-review scope', { timeout: 30_000 }, () => {
  it('counts only the branch own change after it merged the base into a file of the merge request', () => {
    const state = reviewedState()
    sh('checkout', '-q', 'main')
    commit({ 'a.ts': `${lines(100, 'main')}\n${lines(20, 'a')}` }, 'base moves on')
    sh('checkout', '-q', 'feature')
    sh('merge', '-q', '--no-edit', 'main')
    commit({ 'b.ts': `${lines(5, 'b')}\nfeature\nfix` }, 'fix')
    const scope = rereviewScope(root, state, 'main')
    expect(scope.kind).toBe('patches')
    expect(scope.files.map((file) => [file.path, file.added + file.deleted])).toEqual([['b.ts', 1]])
    expect(scope.total).toBe(2)
    const statePath = join(root, '.git', 'review-state.json')
    writeFileSync(statePath, JSON.stringify(state))
    const report = buildReport(root, { base: 'main', spec: false, agent: 'claude', statePath })
    expect([report.plan.lines, report.diff]).toEqual([1, `git diff ${state.last_reviewed_sha} -- b.ts`])
  })

  it('restores the scope from patches after a force-push onto a new base', () => {
    const state = reviewedState()
    sh('checkout', '-q', 'main')
    commit({ 'c.ts': 'c' }, 'base moves on')
    sh('checkout', '-q', 'feature')
    sh('rebase', '-q', 'main')
    commit({ 'b.ts': `${lines(5, 'b')}\nfeature\nfix` }, 'fix')
    expect(rereviewScope(root, state, 'main')).toMatchObject({ kind: 'patches', files: [{ path: 'b.ts', added: 1, deleted: 0 }], total: 2 })
  })

  it('takes the short path when the merge request diff did not change', () => {
    expect(rereviewScope(root, reviewedState(), 'main')).toMatchObject({ kind: 'unchanged' })
  })

  it('falls back to the full diff when the state does not describe its own range', () => {
    const scope = rereviewScope(root, { ...reviewedState(), diff_hash: 'stale' }, 'main')
    expect(scope).toMatchObject({ kind: 'full', reason: 'diff_hash does not match base_sha...last_reviewed_sha' })
    expect(scope.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts'])
  })
})
