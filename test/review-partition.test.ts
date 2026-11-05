import { describe, expect, it } from 'vitest'
import { estimateLine, estimateReview, finderReader } from '../src/review/estimate'
import { importSpecifiers, partitionFiles, resolveEdges, type PartitionFile } from '../src/review/partition'
import { DEFAULT_PRICES } from '../src/review/prices'

const code = (path: string, countedLines = 100): PartitionFile => ({ path, countedLines, kind: 'code' })
const filesOf = (files: readonly PartitionFile[], edges: readonly (readonly [string, string])[], count: number) =>
  partitionFiles(files, edges, count).map((partition) => partition.files)

describe('partitions', () => {
  const feature = [
    code('src/journal/store.ts'),
    code('src/journal/filters.ts'),
    code('src/widgets/journal-panel/panel.vue'),
    code('src/settings/form.ts'),
    code('src/settings/schema.ts'),
    code('src/shared/ui/button.vue'),
  ]

  it('keeps files that import each other together even across directories', () => {
    const partitions = filesOf(feature, [['src/widgets/journal-panel/panel.vue', 'src/journal/store.ts']], 4)
    expect(partitions.find((files) => files.includes('src/journal/store.ts'))).toContain('src/widgets/journal-panel/panel.vue')
    expect(partitions.find((files) => files.includes('src/settings/form.ts'))).toContain('src/settings/schema.ts')
  })

  it.each([1, 2, 3, 5])('makes exactly %i partitions and puts every file in exactly one', (count) => {
    const files = [...feature, { path: 'src/journal/store.test.ts', countedLines: 0, kind: 'tests' as const }, { path: 'docs/journal.md', countedLines: 0, kind: 'docs' as const }]
    const partitions = filesOf(files, [], count)
    expect(partitions).toHaveLength(count)
    expect(partitions.flat().sort()).toEqual(files.map((file) => file.path).sort())
  })

  it('makes fewer partitions only when the diff has fewer code files', () => {
    expect(filesOf([code('a.ts'), code('b.ts')], [], 5)).toEqual([['a.ts'], ['b.ts']])
    expect(filesOf([{ path: 'docs/a.md', countedLines: 0, kind: 'docs' }], [], 3)).toEqual([['docs/a.md']])
  })

  it('puts a test with the source it names or imports, not with its directory neighbours', () => {
    const files = [code('src/a/store.ts'), code('src/b/other.ts'), { path: 'src/b/__tests__/store.spec.ts', countedLines: 0, kind: 'tests' as const }, { path: 'test/flow.test.ts', countedLines: 0, kind: 'tests' as const }]
    const partitions = filesOf(files, [['test/flow.test.ts', 'src/b/other.ts']], 2)
    expect(partitions).toEqual([['src/a/store.ts', 'src/b/__tests__/store.spec.ts'], ['src/b/other.ts', 'test/flow.test.ts']])
  })

  it('a few lines in an unrelated directory join another partition instead of taking a finder of their own', () => {
    const files = [code('tools/auth.ts', 5), code('src/catalog/big.ts', 1000), ...Array.from({ length: 8 }, (_, index) => code(`src/journal/f${index}.ts`, 100))]
    const partitions = partitionFiles(files, [], 3)
    expect(partitions).toHaveLength(3)
    expect(Math.min(...partitions.map((partition) => partition.lines))).toBeGreaterThanOrEqual(200)
  })

  it('balances weight: a hub imported by every file does not pull the whole diff into one partition', () => {
    const files = [code('src/store.ts'), ...Array.from({ length: 8 }, (_, index) => code(`src/views/v${index}.vue`))]
    const edges = Array.from({ length: 8 }, (_, index) => [`src/views/v${index}.vue`, 'src/store.ts'] as const)
    const partitions = partitionFiles(files, edges, 3)
    expect(Math.max(...partitions.map((partition) => partition.lines))).toBeLessThanOrEqual(450)
  })
})

describe('import edges', () => {
  it('resolves relative, index and alias specifiers to the diff files they name', () => {
    const paths = ['src/features/journal/store.ts', 'src/features/journal/index.ts', 'src/widgets/panel.vue', 'src/app/main.ts']
    const specifiers = new Map([
      ['src/widgets/panel.vue', importSpecifiers("import { useJournal } from '@/features/journal/store'\nconst lazy = () => import('../features/journal')")],
      ['src/app/main.ts', importSpecifiers("import { createApp } from 'vue'\nimport './side-effect'")],
    ])
    expect(resolveEdges(paths, specifiers)).toEqual([
      ['src/widgets/panel.vue', 'src/features/journal/store.ts'],
      ['src/widgets/panel.vue', 'src/features/journal/index.ts'],
    ])
  })
})

describe('cost estimate', () => {
  it('a partitioned run costs less than the same diff read whole by as many finders', () => {
    const partitioned = estimateReview(Array.from({ length: 5 }, () => finderReader(2000, 'opus')), DEFAULT_PRICES)
    const whole = estimateReview(Array.from({ length: 5 }, () => finderReader(10_000, 'opus')), DEFAULT_PRICES)
    expect(partitioned.dollars).toBeLessThan(whole.dollars / 2)
  })

  it('names the model it has no price for instead of printing $0', () => {
    expect(estimateLine(estimateReview([finderReader(500, 'gpt-x')], DEFAULT_PRICES))).toMatch(/^cost estimate: no price for gpt-x/)
  })

  it('lands near the measured run on a large merge request: an Opus finder of ~2000 lines $11-20 over ~100 turns', () => {
    const run = estimateReview([finderReader(2050, 'opus')], DEFAULT_PRICES)
    expect(run.finders[0]?.dollars).toBeGreaterThan(10)
    expect(run.finders[0]?.dollars).toBeLessThan(20)
    expect(run.finders[0]?.turns).toBeGreaterThan(90)
    const sizes = estimateReview([finderReader(777, 'opus'), finderReader(3075, 'opus')], DEFAULT_PRICES).finders
    expect(sizes.map((finder) => finder.turns).every((turns) => turns >= 85 && turns <= 120)).toBe(true)
    expect(sizes.map((finder) => finder.context).every((context) => context >= 240_000 && context <= 420_000)).toBe(true)
  })
})
