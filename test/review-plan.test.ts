import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { LAYOUTS, finderCount, gateFiles, judgeModels, planReview, stepsFor, type Angle, type Layout, type Mode, type Shape } from '../src/review/layout'
import { addedLines, buildReport, countLines, formatReport, parseNumstat, parseProjectConfig, readsFor, resolveLayout } from '../src/review/review-plan'

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
    expect(plan.angles).toEqual([1, 2, 3, 4, 5, 8, 10, 12, 13, 14, 15, 16, 17])
    const full = planReview({ lines: 120, shape: EVERY_SHAPE, selector: 'full' })
    expect([full.path, full.angles.length, full.selection.source]).toEqual(['inline', 17, 'argument'])
  })

  it('keeps full as the default selector above N = 1', () => {
    expect(planReview({ lines: 400, shape: CODE_ONLY }).selection).toEqual({ input: 'full', tokens: [], source: 'default' })
  })

  it('lays out one finder per partition, N of them, each with every selected angle on the deep tier at the highest effort of its angles', () => {
    const plan = planReview({ lines: 400, shape: EVERY_SHAPE, layout: 'lean' })
    expect(plan.partitions.map((partition) => partition.name)).toEqual(['p1', 'p2', 'p3'])
    expect(plan.finders.map((finder) => `${finder.name}:${finder.partition}:${finder.angles.length}:${finder.tier}/${finder.effort}`)).toEqual([
      'p1:p1:17:deep/high',
      'p2:p2:17:deep/high',
      'p3:p3:17:deep/high',
    ])
  })

  it('fanout splits each partition by the grades of its angles', () => {
    expect(layout(400).filter((finder) => finder.startsWith('p1-'))).toEqual([
      'p1-deep-high:1+2+3+4+5+9+12+13+15:deep/high',
      'p1-standard-high:6+7+8+10+11+14:standard/high',
      'p1-standard-medium:16+17:standard/medium',
    ])
    expect(layout(400)).toHaveLength(9)
  })

  it('caps the partitions at five', () => {
    expect(planReview({ lines: 10_000, shape: CODE_ONLY }).finders.map((finder) => finder.name)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('leaves out angles the diff shape does not call for', () => {
    const plan = planReview({ lines: 400, shape: CODE_ONLY })
    expect(plan.finders.every((finder) => !finder.angles.includes(16))).toBe(true)
    expect(plan.skipped.map((skip) => skip.angle)).toEqual([11, 15, 16, 17])
  })

  it('reviews only docs, spec, tests and comments when no counted code changed, in one partition', () => {
    expect(layout(0)).toEqual(['p1-standard-high:11:standard/high', 'p1-deep-high:15:deep/high', 'p1-standard-medium:16+17:standard/medium'])
  })

  it('applies a project grade override per token', () => {
    const fanout = planReview({ lines: 400, shape: CODE_ONLY, layout: 'fanout', grades: { bugs: { tier: 'standard', effort: 'medium' } } })
    expect(fanout.finders.filter((finder) => finder.partition === 'p1').map((finder) => `${finder.angles.join('+')}:${finder.tier}/${finder.effort}`)).toEqual([
      '1+2+3+4+5+12:standard/medium',
      '6+7+8+10+14:standard/high',
      '9+13:deep/high',
    ])
    const lean = planReview({ lines: 400, shape: CODE_ONLY, selector: 'bugs', grades: { bugs: { tier: 'standard', effort: 'medium' } } })
    expect(lean.finders.map((finder) => `${finder.tier}/${finder.effort}`)).toEqual(['deep/medium', 'deep/medium', 'deep/medium'])
  })

  it('builds the flow model on every path that reviews, never when nothing is reviewed', () => {
    expect(planReview({ lines: 40, shape: CODE_ONLY }).flow).toEqual({ tier: 'deep', effort: 'high' })
    expect(planReview({ lines: 900, shape: CODE_ONLY }).flow).toEqual({ tier: 'deep', effort: 'high' })
    expect(planReview({ lines: 0, shape: CODE_ONLY }).flow).toBeUndefined()
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

  it('lean and solo run two partition finders on 212 lines; fanout splits each by grade', () => {
    expect(finders('lean')).toEqual(['p1:1+2+3+4+5+6+7+8+9+10+12+13+14+17:deep/high', 'p2:1+2+3+4+5+6+7+8+9+10+12+13+14+17:deep/high'])
    expect(finders('fanout')).toHaveLength(6)
    expect(finders('solo').every((finder) => finder.includes(':deep/'))).toBe(true)
  })

  it('a re-review range under 600 lines gets one finder for every angle and no deepening; from 600 lines the full layout', () => {
    const rereview = (lines: number) => planReview({ lines, shape: EVERY_SHAPE, rereview: true })
    expect(rereview(450).finders.map((finder) => `${finder.name}:${finder.tier}/${finder.effort}:${finder.angles.length}`)).toEqual(['rereview:deep/medium:17'])
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

  it('a small pre-mr review builds the flow model and reads no state, no comment texts and no finder or verify steps', () => {
    expect(files(40, 'pre-mr', false)).toEqual([
      'steps/02-rules.md',
      'steps/04-flow-model.md',
      'steps/04-inline.md',
      'gates/bugs.md',
      'gates/shape.md',
      'gates/severity.md',
      'steps/06-rank.md',
      'steps/08-output.md',
    ])
  })

  it('a review of a merge request with state reads state and re-review, builds the flow model before the finders, then comment texts and posting', () => {
    expect(files(400, 'review', true)).toEqual([
      'steps/02-rules.md',
      'steps/03-state.md',
      'references/state-schema.md',
      'steps/09-rereview.md',
      'steps/04-flow-model.md',
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
    expect(plan.angles).toEqual([1, 2, 3, 4, 5, 8, 10, 12, 13, 14, 15, 16, 17])
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

  it('leaves tests, fixtures, Markdown and lock files out of LINES', () => {
    const counted = countLines([
      { path: 'src/a.ts', added: 100, deleted: 60 },
      { path: 'src/a.test.ts', added: 500, deleted: 0 },
      { path: 'test/helpers.ts', added: 50, deleted: 0 },
      { path: 'src/__fixtures__/big.json', added: 900, deleted: 0 },
      { path: 'docs/guide.md', added: 70, deleted: 3 },
      { path: 'tauri/Cargo.lock', added: 1400, deleted: 1400 },
      { path: 'apps/api/uv.lock', added: 30, deleted: 0 },
    ])
    expect(counted).toEqual({ lines: 160, counted: 1, excluded: { test: 2, fixture: 1, markdown: 1, lockfile: 2 } })
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
    expect(report.plan.partitions.map((partition) => partition.files)).toEqual([['src/a.ts', 'src/b.test.ts', 'src/b.ts']])
    expect(report.flowModel?.path).toBe(`${report.diffFiles?.dir}/model.md`)
    expect(report.reads['flow-model']?.diff.map((path) => path.split('/').pop())).toEqual(['p1-code-01.diff'])
  })

  it('writes the diff for subagents once, compact, in parts that keep each file whole and an index of line ranges', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
    dirs.push(root)
    vi.stubEnv('JIG_USER_CONFIG', join(root, 'absent.jsonc'))
    const run = (...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root).ok).toBe(true)
    run('init', '-q', '-b', 'main')
    write(root, 'a.ts', 'export const a = 1\n')
    write(root, 'old.ts', 'export const o = 1\nexport const p = 2\n')
    run('add', '-A')
    run('commit', '-qm', 'base')
    write(root, 'big.ts', Array.from({ length: 1600 }, (_, index) => `export const b${index} = ${index}`).join('\n') + '\n')
    write(root, 'a.ts', 'export const a = 2\n')
    write(root, 'package-lock.json', '{}\n')
    rmSync(join(root, 'old.ts'))
    run('add', '-A')
    run('commit', '-qm', 'feature')

    const files = buildReport(root, { base: 'HEAD~1', spec: false, agent: 'claude', layout: 'lean' }).diffFiles

    const text = files?.parts.map((part) => readFileSync(part, 'utf8')).join('') ?? ''
    expect(text.startsWith('=== a.ts\n@@ -1 +1 @@\n-export const a = 1\n+export const a = 2\n=== big.ts (new)\n@@ -0,0 +1,1600 @@\n')).toBe(true)
    expect(text.endsWith('\n=== old.ts (deleted, 2 lines)\n')).toBe(true)
    expect(text).not.toMatch(/^(diff --git|index |--- |\+\+\+ )/m)
    const index = readFileSync(files?.index ?? '', 'utf8').trim().split('\n').map((line) => line.split('\t'))
    expect(index).toEqual([
      ['a.ts', 'p1-code-01.diff:1-4'],
      ['big.ts', 'p2-code-01.diff:1-1602'],
      ['old.ts', 'p3-code-01.diff:1-1'],
      ['package-lock.json', 'not written: lock file, minified, source map or snapshot'],
    ])
  })

  it('gives each finder only the parts of its partition: tests when angle 16 runs, documents when angle 11 or 15 runs', () => {
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

    const store = report.plan.partitions.find((partition) => partition.files.includes('src/store.ts'))
    expect(store?.files).toEqual(['src/model/_tests_/store.ts', 'src/spec/store.check.ts', 'src/store.ts'])
    const partsOf = (name: string | undefined, from = report): string[] => (from.reads[name ?? ''] ?? { diff: [] }).diff.map((path) => path.split('/').pop() ?? '')
    expect(partsOf(store?.name)).toEqual([`${store?.name}-code-01.diff`, `${store?.name}-tests-01.diff`])
    const docs = report.plan.partitions.find((partition) => partition.files.includes('docs/store.md'))
    expect(partsOf(docs?.name)).toContain(`${docs?.name}-docs-01.diff`)
    expect(readFileSync(report.diffFiles?.partitions[store?.name ?? '']?.tests[0] ?? '', 'utf8')).toMatch(/_tests_\/store\.ts[\s\S]*spec\/store\.check\.ts/)
    const bugsOnly = buildReport(root, { base: 'HEAD~1', spec: true, agent: 'claude', layout: 'lean', selector: 'bugs' })
    expect(partsOf(store?.name, bugsOnly)).toEqual([`${store?.name}-code-01.diff`])
  })

  it('prints the cost estimate, the flow model before any finder, and one finder per partition with every angle', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
    dirs.push(root)
    vi.stubEnv('JIG_USER_CONFIG', join(root, 'absent.jsonc'))
    const run = (...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root).ok).toBe(true)
    const body = (name: string, length = 100): string => Array.from({ length }, (_, index) => `export const ${name}${index} = ${index}`).join('\n') + '\n'
    run('init', '-q', '-b', 'main')
    write(root, 'README.md', '# r\n')
    run('add', '-A')
    run('commit', '-qm', 'base')
    write(root, 'src/a/x.ts', `import { y0 } from '../b/y'\n${body('x')}`)
    write(root, 'src/b/y.ts', body('y', 99))
    write(root, 'src/c/one.ts', body('one'))
    write(root, 'src/c/two.ts', body('two'))
    write(root, 'src/d/three.ts', body('three'))
    write(root, 'src/e/four.ts', body('four'))
    run('add', '-A')
    run('commit', '-qm', 'feature')

    const report = buildReport(root, { base: 'HEAD~1', spec: false, agent: 'claude', layout: 'lean' })
    const printed = formatReport(report).split('\n')

    expect(report.plan.partitions.map((partition) => partition.files)).toEqual([['src/a/x.ts', 'src/b/y.ts'], ['src/c/one.ts', 'src/c/two.ts'], ['src/d/three.ts'], ['src/e/four.ts']])
    const finders = printed.filter((line) => line.startsWith('finder '))
    expect(finders).toHaveLength(4)
    expect(finders.every((line) => line.includes(`angles ${report.plan.angles.join('+')}`))).toBe(true)
    expect(finders[0]).toMatch(/^finder p1: partition p1 \(2 files, 200 lines, under src\/a, src\/b\)/)
    expect(printed.findIndex((line) => line.startsWith('flow model: first'))).toBeLessThan(printed.findIndex((line) => line.startsWith('finder ')))
    expect(printed.find((line) => line.startsWith('cost estimate: '))).toMatch(/^cost estimate: ~\$\d+(\.\d)? \(flow model .* finders 4 × up to \d+k × \d+ turns · list prices of opus/)
    const steps = printed.filter((line) => line.startsWith('  ') && line.includes('/steps/'))
    expect(steps.findIndex((line) => line.includes('04-flow-model.md'))).toBeLessThan(steps.findIndex((line) => line.includes('04-finders.md')))
  })

  it('routes the standards an AGENTS.md links under docs/ to every finder whose partition they cover', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
    dirs.push(root)
    vi.stubEnv('JIG_USER_CONFIG', join(root, 'absent.jsonc'))
    const run = (...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root).ok).toBe(true)
    const body = (name: string): string => Array.from({ length: 200 }, (_, index) => `export const ${name}${index} = ${index}`).join('\n') + '\n'
    run('init', '-q', '-b', 'main')
    write(root, 'AGENTS.md', '## Conventions\n- [code/naming.md](docs/standards/code/naming.md)\n- [code/vue.md](docs/standards/code/vue.md)\n')
    write(root, 'docs/standards/code/naming.md', '# naming\n')
    write(root, 'docs/standards/code/vue.md', '# vue\n')
    write(root, 'src/gis/AGENTS.md', '# gis\n')
    run('add', '-A')
    run('commit', '-qm', 'base')
    write(root, 'src/gis/map.ts', body('m'))
    write(root, 'src/journal/list.ts', body('l'))
    run('add', '-A')
    run('commit', '-qm', 'feature')

    const report = buildReport(root, { base: 'HEAD~1', spec: false, agent: 'claude', layout: 'lean' })

    const rulesOf = (file: string): string[] => report.reads[report.plan.partitions.find((partition) => partition.files.includes(file))?.name ?? '']?.rules ?? []
    expect(rulesOf('src/gis/map.ts')).toEqual(['AGENTS.md', 'src/gis/AGENTS.md', 'docs/standards/code/naming.md', 'docs/standards/code/vue.md'])
    expect(rulesOf('src/journal/list.ts')).toEqual(['AGENTS.md', 'docs/standards/code/naming.md', 'docs/standards/code/vue.md'])
  })
})
