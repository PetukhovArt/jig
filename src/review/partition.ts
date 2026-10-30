import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export interface PartitionFile {
  path: string
  countedLines: number
  kind: 'code' | 'tests' | 'docs'
}

export type Edge = readonly [string, string]

export interface Partition {
  name: string
  files: string[]
  lines: number
  dirs: string[]
}

export const IMPORT_WEIGHT = 4
export const BALANCE = 1.5
export const MIN_SHARE = 0.25

const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g

export const importSpecifiers = (source: string): string[] => [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? '').filter((spec) => spec !== '')

const stripExtension = (path: string): string => path.replace(/\.[^./]+$/, '')
const keysOf = (path: string): string[] => {
  const bare = stripExtension(path)
  return bare.endsWith('/index') ? [bare, bare.slice(0, -'/index'.length)] : [bare]
}

const aliasTail = (spec: string): string | undefined => {
  const tail = stripExtension(spec.replace(/^[@~#]\//, ''))
  return tail.includes('/') ? tail : undefined
}

/** Resolves a specifier of `from` to one of `targets`: a relative one against `from`'s directory; an alias (`@/x/y`, `~/x/y`) or a bare path by its tail of at least two segments. */
export const makeResolver = (targets: readonly string[]): ((from: string, spec: string) => string | undefined) => {
  const byKey = new Map<string, string>()
  for (const path of targets) keysOf(path).forEach((key) => byKey.set(key, path))
  const keys = [...byKey.keys()]
  return (from, spec) => {
    if (spec.startsWith('.')) return byKey.get(stripExtension(posix.normalize(posix.join(posix.dirname(from), spec))))
    const tail = aliasTail(spec)
    const key = tail === undefined ? undefined : keys.find((candidate) => candidate === tail || candidate.endsWith(`/${tail}`))
    return key === undefined ? undefined : byKey.get(key)
  }
}

export const resolveEdges = (paths: readonly string[], specifiers: ReadonlyMap<string, readonly string[]>): Edge[] => {
  const target = makeResolver(paths)
  const edges: Edge[] = []
  for (const from of paths) {
    for (const spec of specifiers.get(from) ?? []) {
      const to = target(from, spec)
      if (to !== undefined && to !== from) edges.push([from, to])
    }
  }
  return edges
}

export const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/

export const importEdges = (root: string, paths: readonly string[]): Edge[] => {
  const specifiers = new Map<string, string[]>()
  for (const path of paths) {
    const full = join(root, path)
    if (!SOURCE_PATTERN.test(path) || !existsSync(full)) continue
    specifiers.set(path, importSpecifiers(readFileSync(full, 'utf8')))
  }
  return resolveEdges(paths, specifiers)
}

const dirOf = (path: string): string[] => path.split('/').slice(0, -1)
const commonPrefix = (left: readonly string[], right: readonly string[]): string[] => {
  const shared: string[] = []
  for (let index = 0; index < Math.min(left.length, right.length) && left[index] === right[index]; index++) shared.push(left[index] ?? '')
  return shared
}

interface Cluster {
  files: string[]
  weight: number
  dir: string[]
}

interface Candidate {
  i: number
  j: number
  score: number
  weight: number
  fits: boolean
}

const pairKey = (left: string, right: string): string => (left < right ? `${left}\0${right}` : `${right}\0${left}`)

const edgeCounts = (edges: readonly Edge[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const [from, to] of edges) counts.set(pairKey(from, to), (counts.get(pairKey(from, to)) ?? 0) + 1)
  return counts
}

const importsBetween = (left: readonly string[], right: readonly string[], counts: ReadonlyMap<string, number>): number => {
  let sum = 0
  for (const a of left) for (const b of right) sum += counts.get(pairKey(a, b)) ?? 0
  return sum
}

const isBetterMerge = (next: Candidate, best: Candidate | undefined): boolean => {
  if (best === undefined) return true
  if (next.fits !== best.fits) return next.fits
  if (next.fits) return next.score > best.score || (next.score === best.score && next.weight < best.weight)
  return next.weight < best.weight || (next.weight === best.weight && next.score > best.score)
}

const singletons = (code: readonly PartitionFile[]): Cluster[] =>
  [...code].sort((left, right) => left.path.localeCompare(right.path)).map((file) => ({ files: [file.path], weight: file.countedLines, dir: dirOf(file.path) }))

const totalWeight = (clusters: readonly Cluster[]): number => clusters.reduce((sum, cluster) => sum + cluster.weight, 0)

const merged = (left: Cluster, right: Cluster): Cluster => ({ files: [...left.files, ...right.files], weight: left.weight + right.weight, dir: commonPrefix(left.dir, right.dir) })

const affinity = (left: Cluster, right: Cluster, counts: ReadonlyMap<string, number>): number =>
  importsBetween(left.files, right.files, counts) * IMPORT_WEIGHT + commonPrefix(left.dir, right.dir).length

const agglomerate = (start: readonly Cluster[], counts: ReadonlyMap<string, number>, count: number): Cluster[] => {
  const clusters = [...start]
  const cap = Math.max(Math.ceil((totalWeight(clusters) / count) * BALANCE), ...clusters.map((cluster) => cluster.weight))
  while (clusters.length > count) {
    let best: Candidate | undefined
    clusters.forEach((left, i) => {
      clusters.slice(i + 1).forEach((right, offset) => {
        const weight = left.weight + right.weight
        const next = { i, j: i + 1 + offset, score: affinity(left, right, counts), weight, fits: weight <= cap }
        if (isBetterMerge(next, best)) best = next
      })
    })
    if (best === undefined) break
    const { i, j } = best
    const joined = merged(clusters[i] as Cluster, clusters[j] as Cluster)
    clusters.splice(j, 1)
    clusters[i] = joined
  }
  return clusters
}

const indexOfMax = <T>(items: readonly T[], key: (item: T) => number): number =>
  items.reduce((best, item, index) => (best === -1 || key(item) > key(items[best] as T) ? index : best), -1)

const absorbStragglers = (start: readonly Cluster[], code: readonly PartitionFile[], counts: ReadonlyMap<string, number>): Cluster[] => {
  let clusters = [...start]
  const floor = (totalWeight(clusters) / clusters.length) * MIN_SHARE
  const sizes = new Map(code.map((file) => [file.path, file.countedLines]))
  for (let round = 0; round < start.length; round++) {
    const lightest = indexOfMax(clusters, (cluster) => -cluster.weight)
    const straggler = clusters[lightest] as Cluster
    const heaviest = indexOfMax(clusters, (cluster) => (cluster.files.length > 1 && cluster !== straggler ? cluster.weight : -1))
    const host = clusters[heaviest]
    if (straggler.weight >= floor || host === undefined || host.files.length < 2) break
    const others = clusters.filter((cluster) => cluster !== straggler && cluster !== host)
    const partner = others[indexOfMax(others, (cluster) => affinity(straggler, cluster, counts) * 1e9 - cluster.weight)]
    const halves = agglomerate(
      singletons(host.files.map((path) => ({ path, countedLines: sizes.get(path) ?? 0, kind: 'code' }))),
      counts,
      2,
    )
    const absorbed = partner === undefined ? [] : [merged(partner, straggler)]
    if (absorbed.length === 0) break
    clusters = [...others.filter((cluster) => cluster !== partner), ...absorbed, ...halves]
  }
  return clusters
}

const clusterCode = (code: readonly PartitionFile[], counts: ReadonlyMap<string, number>, count: number): Cluster[] =>
  absorbStragglers(agglomerate(singletons(code), counts, count), code, counts)

const testStem = (path: string): string =>
  (path.split('/').pop() ?? path)
    .replace(/\.[^.]+$/, '')
    .replace(/[._-](?:test|spec|stories|story)$/i, '')
    .replace(/^test_/, '')

const affinityOf = (file: PartitionFile, cluster: Cluster, counts: ReadonlyMap<string, number>): number[] => [
  file.kind === 'tests' && cluster.files.some((path) => path !== file.path && testStem(path) === testStem(file.path)) ? 1 : 0,
  importsBetween(cluster.files, [file.path], counts),
  Math.max(0, ...cluster.files.map((path) => commonPrefix(dirOf(path), dirOf(file.path)).length)),
  -cluster.weight,
]

const compareAffinity = (left: readonly number[], right: readonly number[]): number => {
  for (let index = 0; index < left.length; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

const homeOf = (file: PartitionFile, clusters: readonly Cluster[], counts: ReadonlyMap<string, number>): Cluster => {
  const scored = clusters.map((cluster) => ({ cluster, affinity: affinityOf(file, cluster, counts) }))
  return scored.reduce((best, next) => (compareAffinity(next.affinity, best.affinity) > 0 ? next : best)).cluster
}

const dirsOf = (files: readonly string[]): string[] => {
  const counts = new Map<string, number>()
  for (const path of files) {
    const dir = dirOf(path).join('/') || '.'
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([dir]) => dir)
}

/**
 * `count` partitions, fewer only when the diff has fewer code files. Code files merge by imports between them and their shared directory;
 * a test joins the partition of the source it names or imports, a document the one it sits next to.
 */
export const partitionFiles = (files: readonly PartitionFile[], edges: readonly Edge[], count: number): Partition[] => {
  const counts = edgeCounts(edges)
  const code = files.filter((file) => file.kind === 'code')
  const clusters: Cluster[] = code.length === 0 ? [{ files: [], weight: 0, dir: [] }] : clusterCode(code, counts, Math.max(1, Math.min(count, code.length)))
  const rest = files.filter((file) => file.kind !== 'code').sort((left, right) => left.path.localeCompare(right.path))
  for (const file of rest) homeOf(file, clusters, counts).files.push(file.path)
  const counted = new Map(files.map((file) => [file.path, file.countedLines]))
  return clusters
    .map((cluster) => [...cluster.files].sort((left, right) => left.localeCompare(right)))
    .sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? ''))
    .map((own, index) => ({
      name: `p${index + 1}`,
      files: own,
      lines: own.reduce((sum, path) => sum + (counted.get(path) ?? 0), 0),
      dirs: dirsOf(own),
    }))
}
