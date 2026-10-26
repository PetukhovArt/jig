import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { reviewInputs } from '../src/review/rules'

let root: string

const write = (path: string, text = 'x\n'): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const sh = (...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  if (!result.ok) throw new Error(result.stderr)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-rules-'))
  sh('init', '-q', '-b', 'main')
  for (const path of ['AGENTS.md', 'src/payments/AGENTS.md', 'src/payments/deep/REVIEW.md', 'src/other/CLAUDE.md', 'standards/naming.md', 'notes/code-style.md', 'docs/architecture.md', 'docs/adr/0001-layers.md', 'src/payments/deep/pay.ts']) {
    write(path)
  }
  sh('add', '-A')
  sh('commit', '-q', '-m', 'base')
  sh('checkout', '-q', '-b', 'feature')
  write('src/payments/deep/pay.ts', 'changed\n')
  write('src/payments/deep/my folder/new file.ts', 'new\n')
  sh('add', '-A')
  sh('commit', '-q', '-m', 'work')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('review inputs', { timeout: 30_000 }, () => {
  it('walks up from every changed file, paths with spaces included, and lists standards and architecture documents', () => {
    expect(reviewInputs(root, 'main', [], {})).toEqual({
      indexes: ['AGENTS.md', 'src/payments/AGENTS.md', 'src/payments/deep/REVIEW.md'],
      standards: ['notes/code-style.md', 'standards/naming.md'],
      architecture: ['docs/architecture.md'],
    })
  })

  it('takes the index names, standards and exclusions from .jig/review.jsonc, and REVIEW_RULES over the standards', () => {
    write('.jig/review.jsonc', '{ "discover": { "rules": ["REVIEW.md"], "standards": ["docs/**/*.md"], "exclude": ["docs/adr/**"] } }')
    expect(reviewInputs(root, 'main', [], {})).toMatchObject({
      indexes: ['src/payments/deep/REVIEW.md'],
      standards: ['docs/architecture.md', 'notes/code-style.md', 'standards/naming.md'],
    })
    expect(reviewInputs(root, 'main', [], { REVIEW_RULES: 'notes/*.md' }).standards).toEqual(['notes/code-style.md'])
  })
})
