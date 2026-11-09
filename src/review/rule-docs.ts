import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { git } from '../core/git'
import { createMatcher } from '../core/glob'
import { parseJsonc } from '../core/jsonc'
import { jigPaths } from '../core/paths'
import { listWorktrees } from '../worktree/list'

export const PROJECT_CONFIG = 'review.jsonc'

export interface ReviewInputs {
  indexes: string[]
  standards: string[]
  glossaries: string[]
  /** Per index, standard and glossary: the directory whose files it governs, `''` for the whole repository. */
  scopes: Record<string, string>
}

interface Discover {
  rules: string[]
  standards: string[]
  exclude: string[]
}

const DEFAULT_DISCOVER: Discover = {
  rules: ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'REVIEW.md'],
  standards: ['**/{standards,conventions}/**/*.md'],
  exclude: ['**/{tracker,packages,adr,adrs,doc}/**', 'docs/*.md'],
}
const STANDARD_NAME = /review|convention|standard|code[-_ ]?style|guideline/i
const GLOSSARY_MAP = /(^|\/)glossary[-_ ]?map\.md$/i
const GLOSSARY = /(^|\/)[^/]*glossary[^/]*\.md$/i
const MARKDOWN_LINK = /\]\(<?([^)>\s#]+\.md)(?:#[^)\s]*)?>?\)|(?:^|\s)@([^\s]+\.md)/g

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

const isTracked = (root: string, path: string): boolean => {
  const result = git(['ls-files', '--', path], root)
  return result.ok && result.stdout.trim() !== ''
}

export const projectConfigFile = (root: string): { path: string; root: string } | undefined => {
  const own = join(jigPaths(root).dir, PROJECT_CONFIG)
  if (existsSync(own) && isTracked(root, `.jig/${PROJECT_CONFIG}`)) return { path: own, root }
  const mainRoot = listWorktrees(root)[0]?.path
  const main = mainRoot === undefined ? undefined : join(jigPaths(mainRoot).dir, PROJECT_CONFIG)
  if (mainRoot !== undefined && main !== undefined && existsSync(main)) return { path: main, root: mainRoot }
  return existsSync(own) ? { path: own, root } : undefined
}

const readDiscover = (root: string): Discover => {
  const path = projectConfigFile(root)?.path
  if (path === undefined) return DEFAULT_DISCOVER
  const config = parseJsonc(readFileSync(path, 'utf8')) as { discover?: Record<string, unknown> } | null
  const discover = config?.discover ?? {}
  const pick = (key: keyof Discover): string[] => {
    const value = discover[key]
    return isStrings(value) ? value : DEFAULT_DISCOVER[key]
  }
  return { rules: pick('rules'), standards: pick('standards'), exclude: pick('exclude') }
}

const gitList = (root: string, args: string[]): string[] => {
  const result = git(['-c', 'core.quotePath=false', ...args], root)
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.split('\0').filter(Boolean)
}

const ancestors = (file: string): string[] => {
  const dirs: string[] = []
  for (let dir = posix.dirname(file); dir !== '.'; dir = posix.dirname(dir)) dirs.push(dir)
  return [...dirs, '']
}

const sorted = (items: readonly string[]): string[] => [...new Set(items)].sort()
const dirOf = (path: string): string => (posix.dirname(path) === '.' ? '' : posix.dirname(path))
const depthOf = (dir: string): number => (dir === '' ? 0 : dir.split('/').length)

export const linkedDocuments = (index: string, text: string): string[] =>
  [...text.matchAll(MARKDOWN_LINK)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((target) => target !== '' && !/^[a-z]+:/i.test(target))
    .map((target) => posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(dirOf(index), target)))

const standardScopes = (root: string, indexes: readonly string[], standards: readonly string[]): Record<string, string> => {
  const linkers = new Map<string, string[]>()
  for (const index of indexes) {
    for (const target of linkedDocuments(index, readFileSync(join(root, index), 'utf8'))) linkers.set(target, [...(linkers.get(target) ?? []), dirOf(index)])
  }
  const shallowest = (dirs: readonly string[]): string => [...dirs].sort((left, right) => depthOf(left) - depthOf(right) || left.localeCompare(right))[0] ?? ''
  return Object.fromEntries(standards.map((path) => [path, shallowest(linkers.get(path) ?? [''])]))
}

const linksOf = (root: string, path: string): string[] => linkedDocuments(path, readFileSync(join(root, path), 'utf8')).filter((target) => existsSync(join(root, target)))

const glossariesOf = (root: string, indexes: readonly string[], documents: readonly string[], dirs: ReadonlySet<string>): string[] => {
  const fromIndexes = indexes.flatMap((index) => linksOf(root, index))
  const maps = [...documents.filter((path) => !path.includes('/') && GLOSSARY_MAP.test(path)), ...fromIndexes.filter((path) => GLOSSARY_MAP.test(path))]
  const listed = [...new Set(maps)].flatMap((map) => linksOf(root, map))
  const onWalkUp = documents.filter((path) => dirs.has(dirOf(path)) && GLOSSARY.test(path) && !GLOSSARY_MAP.test(path))
  return sorted([...onWalkUp, ...fromIndexes, ...listed].filter((path) => GLOSSARY.test(path) && !GLOSSARY_MAP.test(path)))
}

export const ruleDocuments = (root: string, changed: readonly string[], env: NodeJS.ProcessEnv): ReviewInputs => {
  const discover = readDiscover(root)
  const dirs = new Set(changed.flatMap(ancestors))
  const indexes = sorted(
    [...dirs].flatMap((dir) => discover.rules.map((name) => (dir === '' ? name : `${dir}/${name}`))).filter((path) => existsSync(join(root, path))),
  )
  const documents = gitList(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  const reviewRules = env['REVIEW_RULES']
  const isStandard = createMatcher(reviewRules ? [reviewRules] : discover.standards)
  const isNamedStandard = (path: string): boolean => !reviewRules && STANDARD_NAME.test(path)
  const isExcluded = createMatcher(discover.exclude)
  const isIndex = (path: string): boolean => discover.rules.includes(posix.basename(path))
  const standards = sorted(
    documents.filter((path) => path.toLowerCase().endsWith('.md') && !isIndex(path) && (isStandard(path) || isNamedStandard(path)) && !isExcluded(path)),
  )
  const glossaries = glossariesOf(root, indexes, documents, dirs)
  const scopes = {
    ...Object.fromEntries([...indexes, ...glossaries].map((path) => [path, dirOf(path)])),
    ...standardScopes(root, indexes, standards),
  }
  return { indexes, standards, glossaries, scopes }
}

export const changedPaths = (root: string, mergeBase: string, paths: readonly string[]): string[] =>
  gitList(root, ['diff', '--name-only', '-z', mergeBase, ...(paths.length > 0 ? ['--', ...paths] : [])])

const covers = (scope: string, file: string): boolean => scope === '' || file.startsWith(`${scope}/`)

export const rulesFor = (inputs: ReviewInputs, files: readonly string[]): string[] =>
  [...inputs.indexes, ...inputs.standards, ...inputs.glossaries].filter((path) => files.some((file) => covers(inputs.scopes[path] ?? '', file)))
