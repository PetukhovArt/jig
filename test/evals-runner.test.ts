import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cachedBaseErrors, newErrors, parseEslint, parseTsc, type CheckError } from '../evals/ci-baseline.mjs'
import { budgetCheck, classifyReplay, hiddenTestEvidence, replayVerdict, type ReplayOutcome } from '../evals/eval-steps.mjs'
import { linkModules, unlinkModules } from '../evals/link-modules.mjs'

const error = (line: number, code: string, message: string): CheckError => ({ file: 'src/store.ts', line, column: 1, code, message })
const ARG = "Argument of type 'X[] | undefined' is not assignable"

describe('base error filter', () => {
  const isChanged = (entry: CheckError) => entry.line >= 80

  it.each([
    ['the same file, code and message at another line', [error(54, 'TS2345', ARG)], [error(87, 'TS2345', ARG)], []],
    ['a second occurrence of an error the base has once', [error(54, 'TS2345', ARG)], [error(87, 'TS2345', ARG), error(88, 'TS2345', ARG)], [error(88, 'TS2345', ARG)]],
    ['an occurrence on an unchanged line, which uses up the base one', [error(54, 'TS2345', ARG)], [error(10, 'TS2345', ARG), error(87, 'TS2345', ARG)], [error(87, 'TS2345', ARG)]],
    ['another message or rule', [error(87, 'no-unused-vars', "'a' is unused")], [error(87, 'no-unused-vars', "'b' is unused"), error(88, 'no-undef', "'a' is unused")], [error(87, 'no-unused-vars', "'b' is unused"), error(88, 'no-undef', "'a' is unused")]],
  ])('counts only new errors on changed lines: %s', (_, base, result, expected) => {
    expect(newErrors(result, base, isChanged)).toEqual(expected)
  })

  it('keys tsc and eslint errors by the same project-relative file', () => {
    const tsc = parseTsc("src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n  details\n", 'C:/p')
    const eslint = parseEslint([{ filePath: 'C:\\p\\src\\a.ts', messages: [{ line: 3, column: 7, ruleId: 'no-var', message: 'Unexpected var.', severity: 2 }, { line: 4, ruleId: 'x', message: 'w', severity: 1 }] }], 'C:/p')

    expect(tsc).toEqual([{ file: 'src/a.ts', line: 3, column: 7, code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." }])
    expect(eslint).toEqual([{ file: 'src/a.ts', line: 3, column: 7, code: 'no-var', message: 'Unexpected var.' }])
  })

  it('runs the check on the base once per tool and file set, whatever the order', () => {
    const base = mkdtempSync(join(tmpdir(), 'jig-ci-base-'))
    try {
      let runs = 0
      const check = () => {
        runs++
        return [error(1, 'TS1', 'm')]
      }
      cachedBaseErrors(base, 'tsc', ['src/b.ts', 'src/a.ts'], check)

      expect(cachedBaseErrors(base, 'tsc', ['src/a.ts', 'src/b.ts'], check)).toEqual([error(1, 'TS1', 'm')])
      expect(runs).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('budget', () => {
  it('uses the case estimate until a run finished, then the mean of finished runs', () => {
    expect(budgetCheck({ maxUsd: 10, finishedCosts: [], estimateUsd: 12 }).allowed).toBe(false)
    expect(budgetCheck({ maxUsd: 10, finishedCosts: [], estimateUsd: 8 }).allowed).toBe(true)
    expect(budgetCheck({ maxUsd: 11, finishedCosts: [3, 4], estimateUsd: 20 })).toMatchObject({ allowed: true, projectedUsd: 10.5 })
    expect(budgetCheck({ maxUsd: 10, finishedCosts: [3, 4, 2] }).allowed).toBe(false)
  })

  it('counts each run still in flight at the mean cost', () => {
    expect(budgetCheck({ maxUsd: 10, finishedCosts: [2], inFlight: 3 }).allowed).toBe(true)
    expect(budgetCheck({ maxUsd: 10, finishedCosts: [2], inFlight: 4 }).allowed).toBe(false)
  })
})

describe('act replay retry rule', () => {
  const useCase = { useCase: 'trigger-orphan-operator-use-case', finalSteps: ['trigger-expression-operators-paired'] }

  it.each([
    [1, 'FAIL: replay trigger-orphan-operator-use-case — steps ran, until expr not met after 10s · 6.1s', 'final'],
    [1, 'FAIL: step trigger-expression-operators-paired — steps ran, until expr not met after 10s', 'final'],
    [1, 'FAIL: step trigger-table-row-loaded — steps ran, until not met after 30s', 'early'],
    [3, 'STALE: step trigger-open: step 2/4 click testid=x — not on screen within 10s', 'early'],
    [2, 'connect ECONNREFUSED 127.0.0.1:9921', 'early'],
    [0, 'DONE: replay trigger-orphan-operator-use-case · 4 steps in 3.1s', 'done'],
  ])('exit %i "%s" is %s', (code, output, outcome) => {
    expect(classifyReplay({ code, output }, useCase)).toBe(outcome)
  })

  it.each<[ReplayOutcome[], string]>([
    [['early'], 'retry'],
    [['early', 'early'], 'inconclusive'],
    [['early', 'final'], 'fail'],
    [['early', 'done'], 'pass'],
    [['final'], 'fail'],
  ])('after %j the verdict is %s', (outcomes, verdict) => {
    expect(replayVerdict(outcomes)).toBe(verdict)
  })
})

describe('hidden test evidence', () => {
  const report = (tests: { fullName: string; status: string; failureMessages?: string[] }[], fileStatus = 'passed', message = '') => ({
    testResults: [{ name: 'src/a.test.ts', status: fileStatus, message, assertionResults: tests }],
  })

  it('passes when every test that ran passed, leaving out the filtered ones', () => {
    const evidence = hiddenTestEvidence(report([{ fullName: 'keeps a zone', status: 'passed' }, { fullName: 'other', status: 'skipped' }]))

    expect(evidence.text.split('\n')).toEqual(['HIDDEN: PASS', '1 passed, 0 failed', 'PASS keeps a zone'])
  })

  it.each([
    ['a failed test', report([{ fullName: 'keeps a zone', status: 'failed', failureMessages: ['AssertionError: expected 1 to be 0\n  at x'] }], 'failed'), 'FAIL keeps a zone: AssertionError: expected 1 to be 0'],
    ['no test matched the filter', report([{ fullName: 'x', status: 'skipped' }]), '0 passed, 0 failed'],
    ['a file that did not load', report([], 'failed', 'Failed to load ./store'), 'FILE FAILED src/a.test.ts: Failed to load ./store'],
  ])('fails on %s', (_, input, line) => {
    const evidence = hiddenTestEvidence(input)

    expect(evidence.text.split('\n')).toContain('HIDDEN: FAIL')
    expect(evidence.text.split('\n')).toContain(line)
  })
})

describe('link modules', () => {
  it('links packages, leaves cache dirs to the new project, and unlinks without touching the shared ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-link-'))
    try {
      const shared = join(root, 'shared')
      mkdirSync(join(shared, 'vitest'), { recursive: true })
      mkdirSync(join(shared, '.vite', 'deps'), { recursive: true })
      writeFileSync(join(shared, 'vitest', 'package.json'), '{}')
      writeFileSync(join(shared, '.package-lock.json'), '{}')
      const target = join(root, 'project', 'node_modules')

      linkModules(shared, target)
      expect(readdirSync(target).sort()).toEqual(['.package-lock.json', 'vitest'])
      mkdirSync(join(target, '.vite', 'vitest'), { recursive: true })
      unlinkModules(target)
      rmSync(join(root, 'project'), { recursive: true, force: true })

      expect(readdirSync(join(shared, 'vitest'))).toEqual(['package.json'])
      expect(readdirSync(join(shared, '.vite'))).toEqual(['deps'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
