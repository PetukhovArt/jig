import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { LAYOUTS, finderCount, gateFiles, judgeModels, planReview, stepsFor, type Angle, type Layout, type Mode, type Shape } from '../src/review/layout'
import { addedLines, buildReport, countLines, parseNumstat, parseProjectConfig, readsFor, resolveLayout } from '../src/review/review-plan'

const CODE_ONLY: Shape = { tests: false, comments: false, docs: false, newSourceFiles: 0, spec: false }
const EVERY_SHAPE: Shape = { tests: true, comments: true, docs: true, newSourceFiles: 1, spec: true }

const layout = (lines: number, shape: Shape = EVERY_SHAPE, selector?: string) =>
  planReview({ lines, shape, selector, layout: 'fanout' }).finders.map((finder) => `${finder.name}:${finder.angles.join('+')}:${finder.tier}/${finder.effort}`)

describe('finder count', () => {
  it.each([
    [0, 0],
    [1, 1],
    [150, 1],
    [151, 2],
    [600, 4],
    [601, 5],
    [5000, 5],
  ])('%i lines → N = %i', (lines, n) => {
    expect(finderCount(lines)).toBe(n)
  })
})

describe('layout', () => {
  it('reviews N = 1 inline, without finders, on quick unless a selector is given', () => {
    const plan = planReview({ lines: 120, shape: EVERY_SHAPE })
    expect([plan.path, plan.finders, plan.selection.input, plan.selection.source]).toEqual(['inline', [], 'quick', 'small-diff'])
    expect(plan.angles).toEqual([1, 2, 3, 4, 5, 8, 10, 12, 13, 14, 15])
    const full = planReview({ lines: 120, shape: EVERY_SHAPE, selector: 'full' })
    expect([full.path, full.angles.length, full.selection.source]).toEqual(['inline', 17, 'argument'])
  })

  it('keeps full as the default selector above N = 1', () => {
    expect(planReview({ lines: 400, shape: CODE_ONLY }).selection).toEqual({ input: 'full', tokens: [], source: 'default' })
  })

  it('splits N = 3 into two bug finders and cleanup, plus rules and mechanical, one grade per finder', () => {
    expect(layout(400)).toEqual([
      'bugs-1-deep-high:1+4:deep/high',
      'bugs-1-standard-high:8+14:standard/high',
      'bugs-2:2+3+5+12:deep/high',
      'cleanup-standard-high:7:standard/high',
      'cleanup-deep-high:9:deep/high',
      'rules-standard-high:6+10+11:standard/high',
      'rules-deep-high:13+15:deep/high',
      'mechanical:16+17:standard/medium',
    ])
  })

  it('caps bug finders at four groups', () => {
    const bugs = planReview({ lines: 10_000, shape: CODE_ONLY, layout: 'fanout' }).finders.filter((finder) => finder.kind === 'bugs')
    expect(bugs.map((finder) => finder.angles.join('+'))).toEqual(['1+4', '8', '14', '2+3', '5+12'])
  })

  it('leaves out angles the diff shape does not call for', () => {
    const plan = planReview({ lines: 400, shape: CODE_ONLY })
    expect(plan.finders.some((finder) => finder.kind === 'mechanical')).toBe(false)
    expect(plan.skipped.map((skip) => skip.angle)).toEqual([11, 15, 16, 17])
  })

  it('reviews only docs, spec, tests and comments when no counted code changed', () => {
    expect(layout(0)).toEqual(['rules-standard-high:11:standard/high', 'rules-deep-high:15:deep/high', 'mechanical:16+17:standard/medium'])
  })

  it('applies a project grade override per token', () => {
    const plan = planReview({ lines: 400, shape: CODE_ONLY, grades: { bugs: { tier: 'standard', effort: 'medium' } } })
    const bugs = plan.finders.filter((finder) => finder.kind === 'bugs')
    expect(bugs.map((finder) => `${finder.angles.join('+')}:${finder.tier}/${finder.effort}`)).toEqual(['1+4:standard/medium', '8+14:standard/high', '2+3+5+12:standard/medium'])
  })
})

describe('layouts', () => {
  const finders = (name: Layout) =>
    planReview({ lines: 212, shape: { ...CODE_ONLY, comments: true }, layout: name }).finders.map((finder) => `${finder.name}:${finder.angles.join('+')}:${finder.tier}/${finder.effort}`)

  it.each([
    [300, 'inline'],
    [301, 'lean'],
    [5000, 'lean'],
  ])('auto, the default, lays out %i lines as %s', (lines, expected) => {
    expect(planReview({ lines, shape: CODE_ONLY }).layout).toBe(expected)
  })

  it('fanout splits every group by grade: seven finders on 212 lines with added comments; lean keeps four on one tier', () => {
    expect(finders('fanout')).toHaveLength(7)
    expect(finders('lean')).toEqual(['bugs-1:1+2+3+4+5+8+12+14:standard/high', 'cleanup:7+9:standard/high', 'rules:6+10+13:standard/high', 'mechanical:17:standard/medium'])
    expect(finders('solo').every((finder) => finder.includes(':deep/'))).toBe(true)
  })

  it('a re-review range under 600 lines gets one finder for every angle and no deepening; from 600 lines the full layout', () => {
    const rereview = (lines: number) => planReview({ lines, shape: EVERY_SHAPE, rereview: true })
    expect(rereview(450).finders.map((finder) => `${finder.name}:${finder.tier}/${finder.effort}:${finder.angles.length}`)).toEqual(['rereview:standard/high:17'])
    expect(rereview(450).deepening).toBeUndefined()
    expect(rereview(600).finders.length).toBeGreaterThan(1)
    expect(rereview(600).deepening).toBeDefined()
  })

  it('judges by layout: clusters for fanout, the session plus one Important judge for lean and inline, the finders for solo', () => {
    const judging = (name: Layout) => {
      const plan = planReview({ lines: 900, shape: CODE_ONLY, layout: name })
      return `${plan.path}/${plan.judging}`
    }
    expect(LAYOUTS.filter((name) => name !== 'auto').map(judging)).toEqual(['inline/important', 'subagents/clusters', 'subagents/important', 'subagents/self'])
  })

  it('names the 05-verify sections and gate files each judging reads', () => {
    const steps = (name: Layout) => stepsFor(planReview({ lines: 400, shape: CODE_ONLY, layout: name }), 'review', false).map((step) => `${step.file}${step.when === undefined ? '' : ` · ${step.when}`}`)
    expect(steps('lean')).toContain('steps/05-verify.md · sections "Dedup" and "Layout lean"')
    expect(steps('lean')).toContain('gates/bugs.md')
    expect(steps('solo')).toContain('steps/05-verify.md · sections "Dedup" and "Layout solo"')
    expect(steps('solo').some((step) => step.startsWith('gates/'))).toBe(false)
  })

  it('takes --layout over the environment over the project config over the default, and rejects an unknown name', () => {
    expect(resolveLayout('solo', 'lean', 'fanout')).toEqual({ name: 'solo', source: 'argument' })
    expect(resolveLayout(undefined, 'lean', 'fanout')).toEqual({ name: 'lean', source: 'env' })
    expect(resolveLayout(undefined, '', 'fanout')).toEqual({ name: 'fanout', source: 'config' })
    expect(resolveLayout(undefined, undefined, undefined)).toEqual({ name: 'auto', source: 'default' })
    expect(() => resolveLayout(undefined, 'wide', undefined)).toThrow('unknown layout wide in JIG_REVIEW_LAYOUT')
    expect(() => parseProjectConfig('{ "layout": "wide" }', '.jig/review.jsonc')).toThrow('$.layout')
  })
})

describe('steps', () => {
  const files = (lines: number, mode: Mode, state: boolean) => stepsFor(planReview({ lines, shape: CODE_ONLY }), mode, state).map((step) => step.file)

  it('a small pre-mr review reads no state, no comment texts and no finder or verify steps', () => {
    expect(files(40, 'pre-mr', false)).toEqual(['steps/02-rules.md', 'steps/04-inline.md', 'gates/bugs.md', 'gates/shape.md', 'gates/severity.md', 'steps/06-rank.md', 'steps/08-output.md'])
  })

  it('a review of a merge request with state reads state, re-review, comment texts and posting', () => {
    expect(files(400, 'review', true)).toEqual([
      'steps/02-rules.md',
      'steps/03-state.md',
      'references/state-schema.md',
      'steps/09-rereview.md',
      'steps/04-finders.md',
      'steps/05-verify.md',
      'gates/bugs.md',
      'gates/shape.md',
      'gates/severity.md',
      'steps/06-rank.md',
      'steps/07-comments.md',
      'steps/08-output.md',
      'references/posting.md',
    ])
  })

  it('names only the gate files of the angle classes present', () => {
    expect(gateFiles([16, 17])).toEqual(['gates/shape.md', 'gates/severity.md'])
  })
})

describe('reads', () => {
  it('gives every angle file and the atoms it names as paths, so a reader does not search', () => {
    const reads = readsFor(process.cwd(), [4, 16])
    expect(reads.angles.map((path) => path.split('/').pop())).toEqual(['4.language-traps.md', '16.tests.md'])
    expect(reads.atoms.map((path) => path.split('/').pop())).toEqual(['typescript.md', 'effects.md', 'tests.md'])
  })
})

describe('selector', () => {
  it('quick runs only the angles whose ceiling is Important, without deepening', () => {
    const plan = planReview({ lines: 400, shape: EVERY_SHAPE, selector: 'quick' })
    expect(plan.angles).toEqual([1, 2, 3, 4, 5, 8, 10, 12, 13, 14, 15])
    expect(plan.deepening).toBeUndefined()
    expect(plan.outputTokens).toEqual(['important'])
  })

  it('auto adds the cleanup angles to a single finder', () => {
    const plan = planReview({ lines: 100, shape: CODE_ONLY, selector: 'auto' })
    expect(plan.selection.tokens).toEqual(['important', 'reuse', 'simplification', 'altitude', 'conventions'])
    expect(plan.angles).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14])
  })

  it('a project ceiling moves an angle into important', () => {
    const plan = planReview({ lines: 400, shape: CODE_ONLY, selector: 'important', angles: { 7: { severityCeiling: 'Important' }, 1: { enabled: false } } })
    expect(plan.angles).toContain(7)
    expect(plan.angles).not.toContain(1)
    expect(plan.skipped).toContainEqual({ angle: 1, reason: 'disabled in the project config' })
  })

  it('rejects an unknown token by name', () => {
    expect(() => planReview({ lines: 10, shape: CODE_ONLY, selector: 'bugs,typos' })).toThrow('unknown selector token typos')
  })
})

describe('judge model', () => {
  it('takes another model of the verify tier than the finder', () => {
    expect(judgeModels(['opus', 'sonnet', 'opus'], ['opus', 'sonnet'])).toEqual([
      { finderModel: 'opus', judgeModel: 'sonnet', same: false },
      { finderModel: 'sonnet', judgeModel: 'opus', same: false },
    ])
  })

  it('says so when the tier has one model', () => {
    expect(judgeModels(['opus'], ['opus'])).toEqual([{ finderModel: 'opus', judgeModel: 'opus', same: true }])
  })
})

describe('numstat', () => {
  it('reads renames and binary files from -z output', () => {
    const output = '3\t1\tsrc/a.ts\0' + '0\t0\t\0src/old.ts\0src/new.ts\0' + '-\t-\tassets/logo.png\0'
    expect(parseNumstat(output)).toEqual([
      { path: 'src/a.ts', added: 3, deleted: 1 },
      { path: 'src/new.ts', added: 0, deleted: 0 },
      { path: 'assets/logo.png', added: 0, deleted: 0 },
    ])
  })

  it('leaves tests, fixtures and Markdown out of LINES', () => {
    const counted = countLines([
      { path: 'src/a.ts', added: 100, deleted: 60 },
      { path: 'src/a.test.ts', added: 500, deleted: 0 },
      { path: 'test/helpers.ts', added: 50, deleted: 0 },
      { path: 'src/__fixtures__/big.json', added: 900, deleted: 0 },
      { path: 'docs/guide.md', added: 70, deleted: 3 },
    ])
    expect(counted).toEqual({ lines: 160, counted: 1, excluded: { test: 2, fixture: 1, markdown: 1 } })
  })

  it('maps added lines from a -U0 patch', () => {
    const patch = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -1,0 +2,2 @@', '+a', '+b', '@@ -9 +11 @@', '-c', '+d'].join('\n')
    expect([...(addedLines(patch).get('x.ts') ?? [])]).toEqual([2, 3, 11])
  })
})

describe('project config', () => {
  it('reports a bad angle and tier with their paths', () => {
    expect(() => parseProjectConfig('{ "angles": { "18": {} }, "tiers": { "bugs": { "tier": "huge", "effort": "high" } } }', '.jig/review.jsonc')).toThrow(
      '.jig/review.jsonc: $.angles["18"]: expected an angle number 1..17; $.tiers.bugs.tier: expected one of deep, standard, fast',
    )
  })
})

describe('buildReport on a repository', () => {
  const dirs: string[] = []
  afterEach(() => {
    vi.unstubAllEnvs()
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  })

  const write = (root: string, file: string, text: string): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }

  it('counts committed and uncommitted work against the merge base and reads the shape', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
    dirs.push(root)
    vi.stubEnv('JIG_USER_CONFIG', join(root, 'absent.jsonc'))
    const run = (...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root).ok).toBe(true)
    run('init', '-q', '-b', 'main')
    write(root, 'src/a.ts', 'export const a = 1\n')
    run('add', '-A')
    run('commit', '-qm', 'base')
    run('checkout', '-qb', 'feature')
    write(root, 'src/b.ts', Array.from({ length: 200 }, (_, index) => `export const b${index} = ${index}`).join('\n') + '\n')
    write(root, 'src/b.test.ts', "it('b', () => {})\n")
    run('add', '-A')
    run('commit', '-qm', 'feature')
    write(root, 'src/a.ts', '// why a is one\nexport const a = 1\n')

    const report = buildReport(root, { base: 'main', spec: false, agent: 'claude' })

    expect(report.plan.lines).toBe(201)
    expect(report.plan.n).toBe(2)
    expect(report.shape).toEqual({ tests: true, comments: true, docs: false, newSourceFiles: 1, spec: false })
    expect(report.judge).toContainEqual({ finderModel: 'opus', judgeModel: 'sonnet', same: false })

    const scoped = buildReport(root, { base: 'main', spec: false, agent: 'claude', paths: ['src/a.ts'] })

    expect(scoped.plan.lines).toBe(1)
    expect(scoped.shape).toEqual({ tests: false, comments: true, docs: false, newSourceFiles: 0, spec: false })
    expect(scoped.diff).toBe(`git diff ${scoped.base.mergeBase} -- src/a.ts`)
    expect(() => buildReport(root, { base: 'main', spec: false, agent: 'claude', paths: ['lib/a.ts'] })).toThrow('nothing changed against main under lib/a.ts')
    expect(report.diffFiles).toBeNull()
  })

  it('writes the diff for subagents once, in parts that keep each file whole and an index of line ranges', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
    dirs.push(root)
    vi.stubEnv('JIG_USER_CONFIG', join(root, 'absent.jsonc'))
    const run = (...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root).ok).toBe(true)
    run('init', '-q', '-b', 'main')
    write(root, 'a.ts', 'export const a = 1\n')
    run('add', '-A')
    run('commit', '-qm', 'base')
    write(root, 'big.ts', Array.from({ length: 1600 }, (_, index) => `export const b${index} = ${index}`).join('\n') + '\n')
    write(root, 'a.ts', 'export const a = 2\n')
    run('add', '-A')
    run('commit', '-qm', 'feature')

    const files = buildReport(root, { base: 'HEAD~1', spec: false, agent: 'claude', layout: 'lean' }).diffFiles

    const whole = git(['diff', '--no-color', 'HEAD~1'], root).stdout
    expect(files?.parts.map((part) => readFileSync(part, 'utf8')).join('')).toBe(whole)
    const index = readFileSync(files?.index ?? '', 'utf8').trim().split('\n').map((line) => line.split('\t'))
    expect(index).toEqual([
      ['a.ts', 'code-01.diff:1-7'],
      ['big.ts', 'code-02.diff:1-1606'],
    ])
  })

  it('gives test files only to the finder with angle 16 and documents only to the one with angles 11 and 15', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
    dirs.push(root)
    vi.stubEnv('JIG_USER_CONFIG', join(root, 'absent.jsonc'))
    const run = (...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root).ok).toBe(true)
    run('init', '-q', '-b', 'main')
    write(root, 'a.ts', 'export const a = 1\n')
    run('add', '-A')
    run('commit', '-qm', 'base')
    write(root, 'src/store.ts', Array.from({ length: 500 }, (_, index) => `export const s${index} = ${index}`).join('\n') + '\n')
    write(root, 'src/model/_tests_/store.ts', "it('s', () => {})\n")
    write(root, 'src/spec/store.check.ts', "it('c', () => {})\n")
    write(root, 'docs/store.md', '# Store\n')
    write(root, '.jig/review.jsonc', '{ "testPaths": ["**/spec/**"] }\n')
    run('add', '-A')
    run('commit', '-qm', 'feature')

    const report = buildReport(root, { base: 'HEAD~1', spec: true, agent: 'claude', layout: 'lean' })

    const partsOf = (angle: Angle): string[] =>
      (report.reads[report.plan.finders.find((finder) => finder.angles.includes(angle))?.name ?? ''] ?? { diff: [] }).diff.map((path) => path.split('/').pop() ?? '')
    expect(partsOf(1)).toEqual(['code-01.diff'])
    expect(partsOf(16)).toEqual(['code-01.diff', 'tests-01.diff'])
    expect(partsOf(15)).toEqual(['code-01.diff', 'docs-01.diff'])
    expect(readFileSync(report.diffFiles?.audiences.tests[0] ?? '', 'utf8')).toMatch(/_tests_\/store\.ts[\s\S]*spec\/store\.check\.ts/)
  })
})
