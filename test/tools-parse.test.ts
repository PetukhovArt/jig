import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEslint } from '../src/catalog/tools/eslint'
import { parseOxlint } from '../src/catalog/tools/oxlint'
import { parseStratum } from '../src/catalog/tools/stratum'
import { parseTscOutput } from '../src/catalog/tools/tsc'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'tools', name), 'utf8')
const root = join(__dirname, 'fixtures', 'tools', 'project')

describe('tool output parsing', () => {
  it('maps oxlint diagnostics to findings at the start line', () => {
    expect(parseOxlint(fixture('oxlint.json'), root)).toEqual([
      { tool: 'oxlint', rule: 'eslint(no-unused-vars)', severity: 'warn', file: 'src/a.ts', line: 1, message: "'unused' is declared but never used." },
      { tool: 'oxlint', rule: 'eslint(no-debugger)', severity: 'error', file: 'src/a.ts', line: 3, message: 'Unexpected `debugger` statement' },
    ])
  })

  it('maps eslint messages with severity 2 to errors and project-relative paths', () => {
    const output = fixture('eslint.json').replaceAll('ROOT/', `${root.replace(/\\/g, '/')}/`)
    expect(parseEslint(output, root).map(({ rule, severity, file, line }) => ({ rule, severity, file, line }))).toEqual([
      { rule: 'no-unused-vars', severity: 'error', file: 'src/c.js', line: 1 },
      { rule: 'no-console', severity: 'warn', file: 'src/c.js', line: 2 },
      { rule: 'eqeqeq', severity: 'error', file: 'src/c.js', line: 3 },
    ])
  })

  it('reads tsc error lines into TS-coded findings', () => {
    expect(parseTscOutput(fixture('tsc.txt'), 'tsc', root)).toEqual([
      { tool: 'tsc', rule: 'TS2322', severity: 'error', file: 'src/a.ts', line: 1, message: "Type 'string' is not assignable to type 'number'." },
      { tool: 'tsc', rule: 'TS2339', severity: 'error', file: 'src/a.ts', line: 2, message: "Property 'foo' does not exist on type 'string'." },
      { tool: 'tsc', rule: 'TS2322', severity: 'error', file: 'src/b.ts', line: 2, message: "Type 'number' is not assignable to type 'string'." },
    ])
  })

  it('reads vue-tsc errors in .vue files and skips continuation lines', () => {
    const findings = parseTscOutput(fixture('vue-tsc.txt'), 'vue-tsc', root)
    expect(findings.map(({ tool, rule, file, line }) => `${tool} ${rule} ${file}:${line}`)).toEqual([
      'vue-tsc TS2322 src/components/Panel.vue:12',
      'vue-tsc TS2339 src/components/Panel.vue:20',
      'vue-tsc TS2741 src/shared/api.ts:4',
    ])
  })

  it('keeps stratum errors and warnings as they are and drops info', () => {
    expect(parseStratum(fixture('stratum.jsonl'))).toEqual([
      {
        tool: 'stratum',
        rule: 'stratum/no-cross-layer-import',
        severity: 'error',
        file: 'src/shared/api/client.ts',
        line: 1,
        message: "Module imports from layer 'features' which 'shared' does not depend on",
        fix: "Move the imported symbol into a layer 'shared' may reach, or add 'features' to 'shared'.depends_on if the dependency is legitimate.",
      },
      {
        tool: 'stratum',
        rule: 'stratum/public-api',
        severity: 'warn',
        file: 'src/shared/api/http.ts',
        line: 2,
        message: 'Import of `src/features/cart/cart.tsx` reaches inside `src/features/cart`',
        fix: 'Import from `src/features/cart` through its entry `src/features/cart/index.ts`, exporting the name there if it is missing.',
      },
    ])
  })
})
