import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig, type JigConfig, type JigRuleId, type Severity } from '../src/core/config'
import { addedComments } from '../src/rules/comments'
import { gateEdit, resetGateAtoms, type GateInput } from '../src/rules/gate'
import type { Edit } from '../src/rules/rule'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'rules')
const PLUGIN_ROOT = resolve(import.meta.dirname, '..')
const BEFORE_MARK = '.before.'
const TS_IGNORE = '@ts-' + 'ignore'

interface Case {
  name: string
  hits: number
}

type Kind = 'bad' | 'good'

const sandbox = mkdtempSync(join(tmpdir(), 'jig-rules-'))
let sessions = 0

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

const withRules = (rules: Partial<Record<JigRuleId, Severity>>): JigConfig => {
  const config = defaultConfig()
  return { ...config, rules: { ...config.rules, ...rules } }
}

const commentGateOn = withRules({ 'jig/comments': 'error', 'jig/tests': 'off' })

const gate = (file: string, edits: Edit[], config: JigConfig, overrides: Partial<GateInput> = {}) =>
  gateEdit({ projectRoot: sandbox, pluginRoot: PLUGIN_ROOT, sessionId: `s${sessions}`, agent: 'main', file, edits, config, ...overrides })

const editCases = (rule: string, kind: Kind, config: JigConfig): Case[] => {
  const dir = join(FIXTURES, rule, kind)
  return readdirSync(dir)
    .filter((name) => !name.includes(BEFORE_MARK))
    .map((name) => {
      const dot = name.indexOf('.')
      const beforePath = join(dir, `${name.slice(0, dot)}${BEFORE_MARK}${name.slice(dot + 1)}`)
      const before = existsSync(beforePath) ? readFileSync(beforePath, 'utf8') : ''
      const after = readFileSync(join(dir, name), 'utf8')
      sessions++
      return { name, hits: gate(`src/${name}`, [{ before, after }], config).hits.length }
    })
}

const casesOf = (kind: Kind): Record<string, Case[]> => ({
  'comment gate': editCases('comments', kind, commentGateOn),
  'suppression ban': editCases('suppressions', kind, defaultConfig()),
  'test gate': editCases('tests', kind, defaultConfig()),
})

describe.each(Object.entries(casesOf('bad')))('%s bad fixtures', (_, cases) => {
  it('recall is 100%', () => {
    const missed = cases.filter((item) => item.hits === 0).map((item) => item.name)
    expect(cases.length).toBeGreaterThan(0)
    expect(missed).toEqual([])
  })
})

describe.each(Object.entries(casesOf('good')))('%s good fixtures', (_, cases) => {
  it('has no false positives', () => {
    const flagged = cases.filter((item) => item.hits > 0).map((item) => item.name)
    expect(cases.length).toBeGreaterThan(0)
    expect(flagged).toEqual([])
  })
})

describe('deny once, then let the same call pass', () => {
  const lastLine = (atom: string): string => readFileSync(join(PLUGIN_ROOT, 'atoms', `${atom}.md`), 'utf8').trim().split('\n').at(-1) ?? ''
  const COMMENT_RULE_LINE = lastLine('comments')
  const TEST_RULE_LINE = lastLine('tests')
  const add = (text: string): Edit[] => [{ before: 'const a = 1\n', after: `const a = 1\n${text}\n` }]

  it('gives the full comments atom first, passes the retry and reminds in one line after that', () => {
    sessions++
    const first = gate('src/a.ts', add('// explains a'), commentGateOn).reason
    expect(first).toContain('// explains a')
    expect(first).toContain('repeat the same call — it will pass')
    expect(first).toContain(COMMENT_RULE_LINE)
    expect(gate('src/a.ts', add('// explains a'), commentGateOn).reason).toBeUndefined()
    const next = gate('src/a.ts', add('// explains a again'), commentGateOn).reason
    expect(next).not.toContain(COMMENT_RULE_LINE)
    expect(next).toMatch(/Rules: .*\/atoms\/comments\.md\.$/)
  })

  it('counts each agent apart and gives the full atom again after a compaction', () => {
    sessions++
    gate('src/a.ts', add('// one'), commentGateOn)
    expect(gate('src/a.ts', add('// one'), commentGateOn, { agent: 'sub-1' }).reason).toContain(COMMENT_RULE_LINE)
    resetGateAtoms(sandbox, `s${sessions}`, 'main')
    expect(gate('src/a.ts', add('// two'), commentGateOn).reason).toContain(COMMENT_RULE_LINE)
  })

  it('never stops a removal', () => {
    sessions++
    expect(gate('src/a.ts', [{ before: '// explains a\nconst a = 1\n', after: 'const a = 1\n' }], commentGateOn)).toEqual({ hits: [] })
    expect(gate('src/a.spec.ts', [{ before: "it('a', f)\nit('b', f)\n", after: "it('a', f)\n" }], defaultConfig())).toEqual({ hits: [] })
  })

  it('gates new comments by default and lets them through once the project turns the gate off', () => {
    sessions++
    expect(gate('src/a.ts', add('// explains a'), defaultConfig()).reason).toMatch(/^jig\/comments: the edit adds 1 comment/)
    sessions++
    expect(gate('src/a.ts', add('// explains a'), withRules({ 'jig/comments': 'off' })).reason).toBeUndefined()
  })

  it('gives the full tests atom on the first new test case and passes the retry', () => {
    sessions++
    const edits = [{ before: '', after: "it('adds', () => {})\n" }]
    const first = gate('src/sum.test.ts', edits, defaultConfig()).reason
    expect(first).toMatch(/^jig\/tests: the edit adds 1 test case\(s\) to src\/sum\.test\.ts\. Read the rules first, then repeat the same call — it will pass\./)
    expect(first).toContain(TEST_RULE_LINE)
    expect(gate('src/sum.test.ts', edits, defaultConfig()).reason).toBeUndefined()
  })

  it('stays silent when the test gate is off', () => {
    sessions++
    expect(gate('src/sum.test.ts', [{ before: '', after: "it('adds', () => {})\n" }], withRules({ 'jig/tests': 'off' }))).toEqual({ hits: [] })
  })
})

describe('suppressions', () => {
  it('denies every time, with the directive and the file line, whatever the comment gate says', () => {
    sessions++
    const edits = [{ before: '', after: `x\n// ${TS_IGNORE}\n` }]
    const expected = `jig/comments: "${TS_IGNORE}" at src/a.ts:2 silences a check. Fix the cause instead; only a human adds suppressions.`
    expect(gate('src/a.ts', edits, defaultConfig()).reason).toBe(expected)
    expect(gate('src/a.ts', edits, defaultConfig()).reason).toBe(expected)
    expect(gate('src/a.ts', edits, withRules({ 'jig/comments': 'off' })).reason).toBe(expected)
  })
})

describe('addedComments', () => {
  it('reports file lines for an edit fragment that starts at line 10', () => {
    const edit = { before: 'const a = 1\n', after: '// explains a\nconst a = 1\n', line: 10 }
    expect(addedComments('src/a.ts', [edit])?.map((comment) => comment.line)).toEqual([10])
  })

  it('lexes the fragment after the file prefix and reports the file line', () => {
    const prefix = 'export function run(): number {\n  /* in the prefix */\n  const a = 1\n'
    const edit = { before: '  return a\n', after: '  // the result\n  return a\n', prefix }
    expect(addedComments('src/run.ts', [edit])).toEqual([{ text: '// the result', key: '// the result', line: 4 }])
  })

  it('does not lex files of other languages', () => {
    expect(addedComments('docs/a.md', [{ before: '', after: '// prose\n' }])).toBeUndefined()
  })
})
