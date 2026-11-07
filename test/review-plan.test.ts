import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { finderCount, gateFiles, judgeModels, planReview, stepsFor, type Layout, type Mode, type ProjectAngle, type Shape } from '../src/review/layout'
import { buildReport, countLines, formatReport, parseNumstat, parseProjectConfig, readsFor, resolveLayout } from '../src/review/review-plan'

const CODE_ONLY: Shape = { tests: false, newSourceFiles: 0, spec: false }
const EVERY_SHAPE: Shape = { tests: true, newSourceFiles: 1, spec: true }
const NAMING: ProjectAngle = { name: 'naming', file: '.jig/angles/naming.md', kind: 'conventions' }

const layout = (lines: number, shape: Shape = EVERY_SHAPE, selector?: string) =>
  planReview({ lines, shape, selector }).finders.map((finder) => `${finder.name}:${finder.angles.join('+')}:${finder.tier}/${finder.effort}`)

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
  it('reviews a small diff like a large one: a behavior finder and a test-reviewer on full by default', () => {
    const plan = planReview({ lines: 40, shape: EVERY_SHAPE })
    expect([plan.path, plan.selection.input, plan.selection.source]).toEqual(['subagents', 'full', 'default'])
    expect(layout(40)).toEqual(['p1-behavior:1+2+3+4+5+8+12+14+15:deep/high', 'p1-tests:16:standard/medium'])
    expect(layout(40, CODE_ONLY)).toEqual(['p1-behavior:1+2+3+4+5+8+12+14:deep/high'])
  })

  it('adds a conventions finder per partition only for the project angles of that kind', () => {
    const plan = planReview({ lines: 400, shape: CODE_ONLY, projectAngles: [NAMING] })
    expect(plan.partitions.map((partition) => partition.name)).toEqual(['p1', 'p2', 'p3'])
    expect(plan.finders.map((finder) => `${finder.name}:${finder.partition}:${finder.kind}`)).toEqual([
      'p1-behavior:p1:behavior',
      'p1-conventions:p1:conventions',
      'p2-behavior:p2:behavior',
      'p2-conventions:p2:conventions',
      'p3-behavior:p3:behavior',
      'p3-conventions:p3:conventions',
    ])
    expect(planReview({ lines: 10_000, shape: CODE_ONLY }).partitions).toHaveLength(5)
  })

  it('leaves out angles the diff shape does not call for, and a finder left without angles', () => {
    const plan = planReview({ lines: 400, shape: CODE_ONLY })
    expect(plan.skipped.map((skip) => skip.angle)).toEqual([15, 16])
    expect(layout(0)).toEqual(['p1-behavior:15:deep/high', 'p1-tests:16:standard/medium'])
    expect(layout(400, CODE_ONLY, 'bugs').every((finder) => finder.includes('-behavior:'))).toBe(true)
  })

  it('takes the grade of each kind from the project tiers', () => {
    const plan = planReview({ lines: 200, shape: CODE_ONLY, projectAngles: [NAMING], grades: { conventions: { tier: 'fast', effort: 'medium' } } })
    expect(plan.finders.filter((finder) => finder.kind === 'conventions').map((finder) => `${finder.tier}/${finder.effort}`)).toEqual(['fast/medium', 'fast/medium'])
  })

  it('a re-review range under 600 lines is one partition and no deepening; from 600 lines N partitions', () => {
    const rereview = (lines: number) => planReview({ lines, shape: EVERY_SHAPE, rereview: true })
    expect(rereview(450).partitions).toHaveLength(1)
    expect(rereview(450).deepening).toBeUndefined()
    expect(rereview(600).partitions).toHaveLength(4)
  })
})

describe('layouts', () => {
  it('auto is lean; solo keeps the two kinds and makes the finders their own judges', () => {
    expect(planReview({ lines: 40, shape: CODE_ONLY }).layout).toBe('lean')
    const solo = planReview({ lines: 400, shape: CODE_ONLY, layout: 'solo', projectAngles: [NAMING] })
    expect([solo.judging, new Set(solo.finders.map((finder) => finder.kind)).size]).toEqual(['self', 2])
  })

  it('names the 05-verify sections and gate files each judging reads', () => {
    const steps = (name: Layout) => stepsFor(planReview({ lines: 400, shape: CODE_ONLY, layout: name }), 'review', false).map((step) => `${step.file}${step.when === undefined ? '' : ` · ${step.when}`}`)
    expect(steps('lean')).toContain('steps/05-verify.md · without section "Layout solo"')
    expect(steps('lean')).toContain('gates/bugs.md')
    expect(steps('solo')).toContain('steps/05-verify.md · without section "Layout lean"')
    expect(steps('solo').some((step) => step.startsWith('gates/'))).toBe(false)
  })

  it('takes --layout over the environment over the project config over the default, and rejects an unknown or removed name', () => {
    expect(resolveLayout('solo', 'lean', 'lean')).toEqual({ name: 'solo', source: 'argument' })
    expect(resolveLayout(undefined, 'lean', 'solo')).toEqual({ name: 'lean', source: 'env' })
    expect(resolveLayout(undefined, '', 'solo')).toEqual({ name: 'solo', source: 'config' })
    expect(resolveLayout(undefined, undefined, undefined)).toEqual({ name: 'auto', source: 'default' })
    expect(() => resolveLayout(undefined, 'inline', undefined)).toThrow('unknown layout inline in JIG_REVIEW_LAYOUT')
    expect(() => parseProjectConfig('{ "layout": "fanout" }', '.jig/review.jsonc')).toThrow('$.layout')
  })
})

describe('steps', () => {
  const files = (lines: number, mode: Mode, state: boolean) => stepsFor(planReview({ lines, shape: CODE_ONLY }), mode, state).map((step) => step.file)

  it('a small pre-mr review runs the finders and reads no state and no comment texts', () => {
    expect(files(40, 'pre-mr', false)).toEqual([
      'steps/02-rules.md',
      'steps/04-finders.md',
      'steps/05-verify.md',
      'gates/bugs.md',
      'gates/shape.md',
      'gates/severity.md',
      'steps/06-rank.md',
      'steps/08-output.md',
    ])
  })

  it('a review of a merge request with state reads state and re-review before the finders, then comment texts and posting', () => {
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
    expect(gateFiles([15])).toEqual(['gates/shape.md', 'gates/severity.md'])
  })
})

describe('reads', () => {
  it('gives every angle file and the atoms it names as paths, so a reader does not search', () => {
    const reads = readsFor(process.cwd(), [4, 8])
    expect(reads.angles.map((path) => path.split('/').pop())).toEqual(['4.language-traps.md', '8.efficiency.md'])
    expect(reads.atoms.map((path) => path.split('/').pop())).toEqual(['typescript.md', 'effects.md', 'why-this-number.md'])
  })
})

describe('selector', () => {
  it('quick runs only the angles whose ceiling is Important, without deepening', () => {
    const plan = planReview({ lines: 400, shape: EVERY_SHAPE, selector: 'quick', angles: { 8: { severityCeiling: 'Nit' } } })
    expect(plan.angles).toEqual([1, 2, 3, 4, 5, 12, 14, 15, 16])
    expect(plan.deepening).toBeUndefined()
    expect(plan.outputTokens).toEqual(['important'])
  })

  it('auto adds tests for changed tests and deepening for new source files', () => {
    expect(planReview({ lines: 100, shape: CODE_ONLY, selector: 'auto' }).selection.tokens).toEqual(['important'])
    expect(planReview({ lines: 100, shape: EVERY_SHAPE, selector: 'auto' }).selection.tokens).toEqual(['important', 'tests', 'deepening'])
  })

  it('a project ceiling moves an angle out of important', () => {
    const plan = planReview({ lines: 400, shape: CODE_ONLY, selector: 'important', angles: { 8: { severityCeiling: 'Nit' }, 1: { enabled: false } } })
    expect(plan.angles).not.toContain(8)
    expect(plan.angles).not.toContain(1)
    expect(plan.skipped).toContainEqual({ angle: 1, reason: 'disabled in the project config' })
  })

  it('rejects an unknown token by name, a removed angle token too', () => {
    expect(() => planReview({ lines: 10, shape: CODE_ONLY, selector: 'bugs,typos' })).toThrow('unknown selector token typos')
    expect(() => planReview({ lines: 10, shape: CODE_ONLY, selector: 'architecture' })).toThrow('unknown selector token architecture')
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
})

describe('project config', () => {
  it('reports a bad angle and tier with their paths, and lets a removed angle number or tier key pass without effect', () => {
    expect(() => parseProjectConfig('{ "angles": { "18": {} }, "tiers": { "behavior": { "tier": "huge", "effort": "high" } } }', '.jig/review.jsonc')).toThrow(
      '.jig/review.jsonc: $.angles["18"]: expected an angle number of 1, 2, 3, 4, 5, 8, 12, 14, 15, 16 or a project angle name; $.tiers.behavior.tier: expected one of deep, standard, fast',
    )
    expect(parseProjectConfig('{ "angles": { "17": { "enabled": false }, "13": { "severityCeiling": "Nit" } } }', '.jig/review.jsonc').angles).toEqual({})
    expect(parseProjectConfig('{ "angles": { "16": { "enabled": false } } }', '.jig/review.jsonc').angles).toEqual({ 16: { enabled: false } })
    expect(parseProjectConfig('{ "tiers": { "flow": { "tier": "deep", "effort": "high" } } }', '.jig/review.jsonc').grades).toEqual({})
  })

  it('takes the partition policy as a non-empty text', () => {
    expect(parseProjectConfig('{ "partitions": " One finder per module. " }', '.jig/review.jsonc').partitions).toBe('One finder per module.')
    expect(parseProjectConfig('{}', '.jig/review.jsonc').partitions).toBeUndefined()
    expect(() => parseProjectConfig('{ "partitions": 3 }', '.jig/review.jsonc')).toThrow('.jig/review.jsonc: $.partitions: expected a string')
    expect(() => parseProjectConfig('{ "partitions": "  " }', '.jig/review.jsonc')).toThrow('$.partitions: expected a non-empty text')
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
    expect(report.shape).toEqual({ tests: true, newSourceFiles: 1, spec: false })
    expect(report.judge).toContainEqual({ finderModel: 'opus', judgeModel: 'sonnet', same: false })

    const scoped = buildReport(root, { base: 'main', spec: false, agent: 'claude', paths: ['src/a.ts'] })

    expect(scoped.plan.lines).toBe(1)
    expect(scoped.shape).toEqual({ tests: false, newSourceFiles: 0, spec: false })
    expect(scoped.diff).toBe(`git diff ${scoped.base.mergeBase} -- src/a.ts`)
    expect(() => buildReport(root, { base: 'main', spec: false, agent: 'claude', paths: ['lib/a.ts'] })).toThrow('nothing changed against main under lib/a.ts')
    expect(report.plan.partitions.map((partition) => partition.files)).toEqual([['src/a.ts'], ['src/b.test.ts', 'src/b.ts']])
    expect(report.plan.finders.filter((finder) => finder.kind === 'tests').map((finder) => `${finder.partition}:${finder.role}:${finder.angles.join('+')}`)).toEqual(['p2:test-reviewer:16'])
    expect(report.diffFiles?.dir.startsWith(tmpdir().replaceAll('\\', '/'))).toBe(true)
    expect(buildReport(root, { base: 'main', spec: false, agent: 'claude' }).run).not.toBe(report.run)
    expect(Object.keys(report.reads)).toEqual(['p1-behavior', 'p2-behavior', 'p2-tests'])
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

  it('plans a linked worktree with the main checkout config when the branch does not track one, and with the branch config when it does', () => {
    const main = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
    const linked = `${main}-linked`
    const tracked = `${main}-tracked`
    dirs.push(main, linked, tracked)
    vi.stubEnv('JIG_USER_CONFIG', join(main, 'absent.jsonc'))
    const run = (cwd: string, ...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], cwd).ok).toBe(true)
    run(main, 'init', '-q', '-b', 'main')
    write(main, '.git/info/exclude', '.jig/\n')
    write(main, 'a.ts', 'export const a = 1\n')
    run(main, 'add', '-A')
    run(main, 'commit', '-qm', 'base')
    write(main, 'a.ts', 'export const a = 2\n// note\n')
    write(main, 'a.test.ts', "it('a', () => {})\n")
    run(main, 'add', '-A')
    run(main, 'commit', '-qm', 'feature')
    run(main, 'worktree', 'add', '-q', '--detach', linked, 'HEAD')
    run(main, 'worktree', 'add', '-q', '-b', 'own', tracked, 'HEAD')
    write(main, '.jig/review.jsonc', '{ "angles": { "8": { "enabled": false }, "14": { "enabled": false } } }\n')
    write(linked, '.jig/review.jsonc', '{}\n')
    write(tracked, '.jig/review.jsonc', '{ "angles": { "14": { "enabled": false } } }\n')
    run(tracked, 'add', '-f', '.jig/review.jsonc')
    run(tracked, 'commit', '-qm', 'own config')
    const angles = (root: string, base: string) => buildReport(root, { base, spec: false, agent: 'claude', layout: 'lean' }).plan.finders.flatMap((finder) => finder.angles)

    expect(angles(linked, 'HEAD~1').filter((angle) => angle === 8 || angle === 14)).toEqual([])
    expect(angles(tracked, 'HEAD~2').filter((angle) => angle === 8 || angle === 14)).toEqual([8])
  })

  it('gives each finder only the code parts of its partition, and the documents when angle 15 runs', () => {
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
    expect(partsOf(`${store?.name}-behavior`)).toEqual([`${store?.name}-code-01.diff`])
    expect(partsOf(`${store?.name}-tests`)).toEqual([`${store?.name}-code-01.diff`, `${store?.name}-tests-01.diff`])
    const docs = report.plan.partitions.find((partition) => partition.files.includes('docs/store.md'))
    expect(partsOf(`${docs?.name}-behavior`)).toContain(`${docs?.name}-docs-01.diff`)
    expect(readFileSync(report.diffFiles?.partitions[store?.name ?? '']?.tests[0] ?? '', 'utf8')).toMatch(/_tests_\/store\.ts[\s\S]*spec\/store\.check\.ts/)
    const bugsOnly = buildReport(root, { base: 'HEAD~1', spec: true, agent: 'claude', layout: 'lean', selector: 'bugs' })
    expect(partsOf(`${store?.name}-behavior`, bugsOnly)).toEqual([`${store?.name}-code-01.diff`])
    expect(bugsOnly.plan.finders.some((finder) => finder.kind === 'tests')).toBe(false)
  })

  it('prints the finders-only cost estimate and one finder per partition with every angle', () => {
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
    expect(finders.every((line) => line.endsWith('· fresh, never a fork'))).toBe(true)
    expect(finders[0]).toMatch(/^finder p1-behavior: partition p1 \(2 files, 200 lines, under src\/a, src\/b\) · behavior: angles 1\+2\+3\+4\+5\+8\+12\+14 · deep\/high opus/)
    expect(printed.find((line) => line.startsWith('cost estimate: '))).toMatch(/^cost estimate: ~\$\d+(\.\d)? · finders 4 × up to \d+k context × \d+ turns · list prices of opus;/)  })

  it('routes the standards an AGENTS.md links under docs/ to every conventions finder whose partition they cover', () => {
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
    write(root, 'GLOSSARY-MAP.md', '- [Common](./GLOSSARY.md)\n- [gis](./src/gis/GLOSSARY.md)\n')
    write(root, 'GLOSSARY.md', '**Channel**\n_Avoid_: camera\n')
    write(root, 'src/gis/GLOSSARY.md', '**Marker**\n')
    write(root, '.jig/angles/naming.md', '# naming\n')
    write(root, '.jig/review.jsonc', '{ "angles": { "naming": { "file": ".jig/angles/naming.md", "kind": "conventions" } } }\n')
    run('add', '-A')
    run('commit', '-qm', 'base')
    write(root, 'src/gis/map.ts', body('m'))
    write(root, 'src/journal/list.ts', body('l'))
    run('add', '-A')
    run('commit', '-qm', 'feature')

    const report = buildReport(root, { base: 'HEAD~1', spec: false, agent: 'claude', layout: 'lean' })

    const rulesOf = (file: string): string[] => report.reads[`${report.plan.partitions.find((partition) => partition.files.includes(file))?.name ?? ''}-conventions`]?.rules ?? []
    expect(report.plan.finders.filter((finder) => finder.kind === 'behavior').every((finder) => report.reads[finder.name]?.rules.length === 0)).toBe(true)
    expect(rulesOf('src/gis/map.ts')).toEqual(['AGENTS.md', 'src/gis/AGENTS.md', 'docs/standards/code/naming.md', 'docs/standards/code/vue.md', 'GLOSSARY.md', 'src/gis/GLOSSARY.md'])
    expect(rulesOf('src/journal/list.ts')).toEqual(['AGENTS.md', 'docs/standards/code/naming.md', 'docs/standards/code/vue.md', 'GLOSSARY.md'])
  })

  describe('a partition policy in the project config', () => {
    const POLICY = 'One finder per feature module whatever its size.'
    const repository = (): string => {
      const root = mkdtempSync(join(tmpdir(), 'jig-review-plan-'))
      dirs.push(root)
      vi.stubEnv('JIG_USER_CONFIG', join(root, 'absent.jsonc'))
      const run = (...args: string[]) => expect(git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root).ok).toBe(true)
      const body = (name: string): string => Array.from({ length: 200 }, (_, index) => `export const ${name}${index} = ${index}`).join('\n') + '\n'
      run('init', '-q', '-b', 'main')
      write(root, '.jig/review.jsonc', JSON.stringify({ partitions: POLICY }))
      run('add', '-A')
      run('commit', '-qm', 'base')
      write(root, 'src/features/editor/a.ts', `import { b0 } from './b'\n${body('a')}`)
      write(root, 'src/features/editor/b.ts', body('b'))
      write(root, 'src/features/editor/a.test.ts', "it('a', () => {})\n")
      write(root, 'src/domain/x/y.ts', body('y'))
      run('add', '-A')
      run('commit', '-qm', 'feature')
      return root
    }

    it('prints the policy, the code files with their lines and the imports between them, and no formula, finders or diff parts', () => {
      const report = buildReport(repository(), { base: 'HEAD~1', spec: false, agent: 'claude' })
      const printed = formatReport(report)

      expect([report.plan.grouping, report.plan.partitions, report.diffFiles, report.estimate]).toEqual(['pending', [], null, null])
      expect(printed).toContain(`partition policy (.jig/review.jsonc): ${POLICY}`)
      expect(printed).toContain('  200\tsrc/domain/x/y.ts\n  201\tsrc/features/editor/a.ts\n  200\tsrc/features/editor/b.ts\n')
      expect(printed).toContain('  src/features/editor/a.ts → src/features/editor/b.ts')
      expect(printed).not.toMatch(/ceil\(|^finder |^steps for this run/m)
    })

    it('writes the parts and finders of the given groups and passes the policy to the finders', () => {
      const root = repository()
      const plan = (...partitions: { name: string; entries: string[] }[]) => buildReport(root, { base: 'HEAD~1', spec: false, agent: 'claude', partitions })
      const report = plan({ name: 'editor', entries: ['src/features/editor/'] }, { name: 'domain', entries: ['src/domain/x/y.ts'] })

      expect(report.plan.partitions.map((partition) => [partition.name, partition.files])).toEqual([
        ['editor', ['src/features/editor/a.test.ts', 'src/features/editor/a.ts', 'src/features/editor/b.ts']],
        ['domain', ['src/domain/x/y.ts']],
      ])
      expect(report.reads['editor-behavior']?.diff.map((path) => path.split('/').pop())).toEqual(['editor-code-01.diff'])
      expect(formatReport(report)).toContain(`partition policy (to every finder, brief item 7): ${POLICY}`)
      expect(() => plan({ name: 'editor', entries: ['src/features/editor/'] })).toThrow('--partition: code files in no group: src/domain/x/y.ts')
      expect(() => plan({ name: 'editor', entries: ['src/features/editor/', 'src/domain/x/y.ts'] }, { name: 'domain', entries: ['src/domain/'] })).toThrow(
        'src/domain/x/y.ts is in groups editor and domain',
      )
    })
  })
})
