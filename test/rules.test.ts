import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/core/config'
import { checkComments } from '../src/rules/comments'
import { checkNoVerify } from '../src/rules/no-verify'
import { checkProtectedPath, checkShellWrite } from '../src/rules/protected'
import { checkSuppressions } from '../src/rules/suppressions'
import type { Finding } from '../src/tools/finding'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'rules')
const BEFORE_MARK = '.before.'

interface Case {
  name: string
  findings: number
}

type Kind = 'bad' | 'good'

const config = defaultConfig()
const sandbox = mkdtempSync(join(tmpdir(), 'jig-rules-'))

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

const count = (finding: Finding | undefined): number => (finding === undefined ? 0 : 1)

const editCases = (rule: string, kind: Kind, check: typeof checkComments): Case[] => {
  const dir = join(FIXTURES, rule, kind)
  return readdirSync(dir)
    .filter((name) => !name.includes(BEFORE_MARK))
    .map((name) => {
      const dot = name.indexOf('.')
      const beforePath = join(dir, `${name.slice(0, dot)}${BEFORE_MARK}${name.slice(dot + 1)}`)
      const before = existsSync(beforePath) ? readFileSync(beforePath, 'utf8') : ''
      const after = readFileSync(join(dir, name), 'utf8')
      return { name, findings: check(name, [{ before, after }], config).length }
    })
}

const lineCases = (rule: string, kind: Kind, list: string, check: (line: string) => number): Case[] =>
  readFileSync(join(FIXTURES, rule, kind, list), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ name: line, findings: check(line) }))

const casesOf = (kind: Kind): Record<string, Case[]> => ({
  'jig/comments': editCases('comments', kind, checkComments),
  'jig/suppressions': editCases('suppressions', kind, checkSuppressions),
  'jig/protected-paths': [
    ...lineCases('protected-paths', kind, 'edits.txt', (file) => count(checkProtectedPath(file, config))),
    ...lineCases('protected-paths', kind, 'commands.txt', (command) =>
      count(checkShellWrite(command, config, { projectRoot: sandbox, cwd: sandbox })),
    ),
  ],
  'jig/no-verify': lineCases('no-verify', kind, 'commands.txt', (command) =>
    count(checkNoVerify(command, { projectRoot: sandbox, sessionId: 'rules-test', config })),
  ),
})

describe.each(Object.entries(casesOf('bad')))('%s bad fixtures', (_, cases) => {
  it('recall is 100%', () => {
    const missed = cases.filter((item) => item.findings === 0).map((item) => item.name)
    expect(cases.length).toBeGreaterThan(0)
    expect(missed).toEqual([])
  })
})

describe.each(Object.entries(casesOf('good')))('%s good fixtures', (_, cases) => {
  it('has no false positives', () => {
    const flagged = cases.filter((item) => item.findings > 0).map((item) => item.name)
    expect(cases.length).toBeGreaterThan(0)
    expect(flagged).toEqual([])
  })
})

describe('rule texts', () => {
  it('names the path and line of a new comment', () => {
    const [finding] = checkComments('src/a.ts', [{ before: '', after: 'const a = 1\n// explains a\n' }], config)
    expect(finding?.message).toMatch(/^jig\/comments: new comment at src\/a\.ts:2 is not allowed\. Allowed: /)
    expect(finding?.message).toMatch(/\(atom comments: .*\/atoms\/comments\.md\)\.$/)
  })

  it('quotes the suppression directive', () => {
    const [finding] = checkSuppressions('src/a.ts', [{ before: '', after: 'x\n// @ts-ignore\n' }], config)
    expect(finding?.message).toBe(
      'jig/suppressions: "@ts-ignore" at src/a.ts:2 silences a check. Fix the cause instead; only a human adds suppressions.',
    )
  })

  it('names the protected path', () => {
    expect(checkProtectedPath('tsconfig.json', config)?.message).toBe(
      'jig/protected-paths: tsconfig.json configures the checks and is protected. Do not change it; tell the user what change you need and why.',
    )
  })

  it('resolves a shell path from the command cwd against the project root', () => {
    const ctx = { projectRoot: sandbox, cwd: join(sandbox, 'src') }
    expect(checkShellWrite('rm ../tsconfig.json', config, ctx)?.file).toBe('tsconfig.json')
    expect(checkShellWrite(`rm ${join(sandbox, '..', 'tsconfig.json')}`, config, ctx)).toBeUndefined()
  })

  it('points to allow-no-verify', () => {
    const finding = checkNoVerify('git commit -nm x', { projectRoot: sandbox, sessionId: 'rules-test', config })
    expect(finding?.message).toMatch(/^jig\/no-verify: commits keep their hooks\. .* run: node .*\/bin\/jig\.mjs allow-no-verify$/)
  })

  it('reports file lines for an edit fragment that starts at line 10', () => {
    const edit = { before: 'const a = 1\n', after: '// explains a\n// @ts-ignore\nconst a = 1\n', line: 10 }
    expect(checkComments('src/a.ts', [edit], config)[0]?.line).toBe(10)
    expect(checkSuppressions('src/a.ts', [edit], config)[0]?.line).toBe(11)
  })

  it('stays silent when the rule is off', () => {
    const off = { rules: { ...config.rules, 'jig/comments': 'off' as const, 'jig/protected-paths': 'off' as const } }
    expect(checkComments('src/a.ts', [{ before: '', after: '// x\n' }], off)).toEqual([])
    expect(checkProtectedPath('tsconfig.json', off)).toBeUndefined()
  })

  it('reports warn severity from the config', () => {
    const warn = { rules: { ...config.rules, 'jig/suppressions': 'warn' as const } }
    expect(checkSuppressions('a.js', [{ before: '', after: '// @ts-nocheck\n' }], warn)[0]?.severity).toBe('warn')
  })
})
