import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { routeFindings } from '../src/review/route'

let root: string

const sh = (...args: string[]): string => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  if (!result.ok) throw new Error(result.stderr)
  return result.stdout.trim()
}

const lines = (count: number, prefix: string): string[] => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`)

const commit = (files: Record<string, string[]>): string => {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), `${text.join('\n')}\n`)
  sh('add', '-A')
  sh('commit', '-q', '-m', 'c')
  return sh('rev-parse', 'HEAD')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-route-'))
  sh('init', '-q')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('review route', () => {
  it('routes by the diff: a finding on a diff file never lands in the FYI note, unless it is optional', () => {
    const base = commit({ 'a.ts': lines(30, 'a'), 'b.ts': lines(5, 'b') })
    const changed = lines(30, 'a')
    changed[9] = 'a10 changed'
    const head = commit({ 'a.ts': changed })
    const finding = (id: string, severity: string, file: string, line: number, extra: Record<string, unknown> = {}) => ({ id, severity, file, line, status: 'open', ...extra })
    const state = {
      findings: [
        finding('on-hunk', 'Important', 'a.ts', 12),
        finding('important-off-hunk', 'Important', 'a.ts', 25),
        finding('nit-off-hunk', 'Nit', 'a.ts', 25),
        finding('nit-outside', 'Nit', 'b.ts', 2),
        finding('important-outside', 'Important', 'b.ts', 2),
        finding('caused', 'Nit', 'b.ts', 3, { caused_by: { file: 'a.ts', line: 10, diff_line: 'a10 changed', victim_line: 'b3' } }),
        finding('false-cause', 'Nit', 'b.ts', 4, { caused_by: { file: 'a.ts', line: 10, diff_line: 'not in the diff', victim_line: 'b4' } }),
        finding('simplify', 'Nit', 'a.ts', 10, { status: 'optional' }),
        finding('posted', 'Important', 'a.ts', 10, { discussion_id: 'd1' }),
        finding('held', 'Important', 'a.ts', 10),
        finding('closed', 'Important', 'a.ts', 10, { status: 'fixed' }),
      ],
      deepening: { module: 'm' },
    }
    expect(routeFindings(root, state, base, head, ['held'])).toEqual([
      { route: 'thread', id: 'on-hunk', severity: 'Important', at: 'a.ts:12' },
      { route: 'discussion', id: 'important-off-hunk', severity: 'Important', at: 'a.ts:25' },
      { route: 'discussion', id: 'nit-off-hunk', severity: 'Nit', at: 'a.ts:25' },
      { route: 'fyi', id: 'nit-outside', severity: 'Nit', at: 'b.ts:2' },
      { route: 'discussion', id: 'important-outside', severity: 'Important', at: 'b.ts:2' },
      { route: 'promoted', id: 'caused', severity: 'Nit', at: 'a.ts:10', victim: 'b.ts:3' },
      { route: 'fyi', id: 'false-cause', severity: 'Nit', at: 'b.ts:4' },
      { route: 'fyi', id: 'simplify', severity: 'optional', at: 'a.ts:10' },
      { route: 'fyi', id: 'deepening', severity: 'deepening', at: '' },
    ])
  })
})
