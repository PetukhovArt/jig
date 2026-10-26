import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { git, gitToplevel } from '../core/git'
import { createMatcher } from '../core/glob'
import { parseJsonc } from '../core/jsonc'
import { jigPaths } from '../core/paths'
import { PROJECT_CONFIG, resolveBase, splitPathspec, toRootPaths } from './review-plan'

type Command = (args: string[]) => number

export interface ReviewInputs {
  indexes: string[]
  standards: string[]
  architecture: string[]
}

interface Discover {
  rules: string[]
  standards: string[]
  exclude: string[]
}

const DEFAULT_DISCOVER: Discover = {
  rules: ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'REVIEW.md'],
  standards: ['**/{standards,conventions}/**/*.md'],
  exclude: ['**/{tracker,packages,adr,doc,docs}/**'],
}
const STANDARD_NAME = /review|convention|standard|code[-_ ]?style|guideline/i
const ARCHITECTURE_NAME = /architect|fsd|layers|boundar/i
const ARCHITECTURE_FILE = /\.(md|html)$/i
const ADR_DIR = /(^|\/)adrs?\//i

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

const readDiscover = (root: string): Discover => {
  const path = join(jigPaths(root).dir, PROJECT_CONFIG)
  if (!existsSync(path)) return DEFAULT_DISCOVER
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

export const reviewInputs = (root: string, base: string, paths: readonly string[], env: NodeJS.ProcessEnv): ReviewInputs => {
  const discover = readDiscover(root)
  const { mergeBase } = resolveBase(root, base, 'review rules', paths)
  const changed = gitList(root, ['diff', '--name-only', '-z', mergeBase, ...(paths.length > 0 ? ['--', ...paths] : [])])
  const dirs = new Set(changed.flatMap(ancestors))
  const indexes = [...dirs]
    .flatMap((dir) => discover.rules.map((name) => (dir === '' ? name : `${dir}/${name}`)))
    .filter((path) => existsSync(join(root, path)))
  const documents = gitList(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  const reviewRules = env['REVIEW_RULES']
  const isStandard = createMatcher(reviewRules ? [reviewRules] : discover.standards)
  const isNamedStandard = (path: string): boolean => !reviewRules && STANDARD_NAME.test(path)
  const isExcluded = createMatcher(discover.exclude)
  const isIndex = (path: string): boolean => discover.rules.includes(posix.basename(path))
  const standards = documents.filter((path) => path.toLowerCase().endsWith('.md') && !isIndex(path) && (isStandard(path) || isNamedStandard(path)) && !isExcluded(path))
  const architecture = documents.filter((path) => ARCHITECTURE_FILE.test(path) && ARCHITECTURE_NAME.test(path) && !ADR_DIR.test(path))
  return { indexes: sorted(indexes), standards: sorted(standards), architecture: sorted(architecture) }
}

const USAGE = 'usage: jig review rules [<base>] [-- <pathspec>...]'

export const runReviewRules: Command = (args) => {
  const split = splitPathspec(args)
  if (split.options.length > 1) throw new Error(USAGE)
  const root = gitToplevel(process.cwd())
  if (root === undefined) throw new Error('not inside a git repository')
  const paths = toRootPaths(root, process.cwd(), split.paths ?? [])
  const inputs = reviewInputs(root, split.options[0] ?? '', paths, process.env)
  const output = [
    ...inputs.indexes.map((path) => `index ${path}`),
    ...inputs.standards.map((path) => `standard ${path}`),
    ...inputs.architecture.map((path) => `architecture ${path}`),
  ]
  process.stdout.write(`${output.join('\n')}\n`)
  return 0
}
