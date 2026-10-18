import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { version as pluginVersion } from '../../package.json'
import { loadConfig, type LoadedConfig } from './config'
import { parseFrontmatter } from './frontmatter'
import { createMatcher } from './glob'
import { jigPaths } from './paths'
import { resolveBin } from './proc'
import { writeFileAtomic } from './state'

export interface ToolWithConfig {
  bin: string[]
  config: string
}

export interface ToolBin {
  bin: string[]
}

export interface PlanTools {
  oxlint?: ToolWithConfig
  eslint?: ToolWithConfig
  tsc?: ToolBin
  vueTsc?: ToolBin
  stratum?: ToolWithConfig
  agentView?: ToolWithConfig
}

export interface PlanAtom {
  name: string
  description: string
  paths?: string[]
  file: string
}

export interface Plan {
  v: 1
  inputsHash: string
  pluginVersion: string
  builtAt: string
  config: LoadedConfig
  tools: PlanTools
  atoms: PlanAtom[]
}

export const OXLINT_CONFIGS = ['.oxlintrc.json', 'oxlint.json', 'oxlintrc.json'] as const
export const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
] as const
export const STRATUM_CONFIG = 'stratum.config.jsonc'
export const AGENT_VIEW_CONFIG = 'agent-view.config.json'
export const TSCONFIG = 'tsconfig.json'

export const TEST_FILE_GLOBS = ['**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/__tests__/**'] as const
export const RUNTIME_VISIBLE_GLOBS = ['**/*.{vue,tsx,jsx,svelte,html,css,scss,less}'] as const
export const AGENT_VIEW_VERIFY_COMMAND =
  /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+(?:act\s+replay|dom|screenshot|snap|click|fill|wait|eval|drag|key|upload)\b/

export const isTestFile = createMatcher(TEST_FILE_GLOBS)

const matchesRuntimeGlob = createMatcher(RUNTIME_VISIBLE_GLOBS)

export const isRuntimeVisible = (path: string): boolean => matchesRuntimeGlob(path) && !isTestFile(path)

const HASHED_INPUTS = [
  ...OXLINT_CONFIGS,
  ...ESLINT_CONFIGS,
  STRATUM_CONFIG,
  AGENT_VIEW_CONFIG,
  TSCONFIG,
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'node_modules/.package-lock.json',
  '.jig/config.jsonc',
]

const fileStamp = (path: string): string => {
  try {
    const stat = statSync(path)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'missing'
  }
}

const isFile = (path: string): boolean => fileStamp(path) !== 'missing'

export const planInputsHash = (projectRoot: string, pluginRoot: string): string => {
  const lines = [`version:${pluginVersion}`, `plugin:${pluginRoot}`, ...HASHED_INPUTS.map((name) => `${name}:${fileStamp(join(projectRoot, name))}`)]
  return createHash('sha1').update(lines.join('\n')).digest('hex')
}

const findConfig = (projectRoot: string, names: readonly string[]): string | undefined =>
  names.map((name) => join(projectRoot, name)).find(isFile)

const withConfig = (config: string | undefined, bin: string[] | undefined): ToolWithConfig | undefined =>
  config !== undefined && bin !== undefined ? { bin, config } : undefined

export const detectTools = (projectRoot: string): PlanTools => {
  const oxlint = withConfig(findConfig(projectRoot, OXLINT_CONFIGS), resolveBin(projectRoot, ['oxlint'], 'oxlint'))
  const eslint = withConfig(findConfig(projectRoot, ESLINT_CONFIGS), resolveBin(projectRoot, ['eslint'], 'eslint'))
  const tsc = resolveBin(projectRoot, ['typescript'], 'tsc')
  const vueTsc = resolveBin(projectRoot, ['vue-tsc'], 'vue-tsc')
  const stratum = withConfig(
    findConfig(projectRoot, [STRATUM_CONFIG]),
    resolveBin(projectRoot, ['@petukhovart/stratum-lint'], 'stratum-lint'),
  )
  const agentView = withConfig(
    findConfig(projectRoot, [AGENT_VIEW_CONFIG]),
    resolveBin(projectRoot, ['@petukhovart/agent-view'], 'agent-view'),
  )
  return {
    ...(oxlint && { oxlint }),
    ...(eslint && { eslint }),
    ...(tsc && { tsc: { bin: tsc } }),
    ...(vueTsc && { vueTsc: { bin: vueTsc } }),
    ...(stratum && { stratum }),
    ...(agentView && { agentView }),
  }
}

const toPlanAtom = (file: string): PlanAtom | undefined => {
  let data: Record<string, string | string[]>
  try {
    data = parseFrontmatter(readFileSync(file, 'utf8'))?.data ?? {}
  } catch {
    return undefined
  }
  const { name, description, paths } = data
  const isIndexable = typeof name === 'string' && typeof description === 'string'
  if (!isIndexable) return undefined
  const atom: PlanAtom = { name, description, file }
  if (Array.isArray(paths) && paths.length > 0) {
    atom.paths = paths
  }
  return atom
}

export const readAtomIndex = (pluginRoot: string): PlanAtom[] => {
  const dir = join(pluginRoot, 'atoms')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => toPlanAtom(join(dir, name)))
    .filter((atom): atom is PlanAtom => atom !== undefined)
}

export const buildPlan = (projectRoot: string, pluginRoot: string, now: Date = new Date()): Plan => ({
  v: 1,
  inputsHash: planInputsHash(projectRoot, pluginRoot),
  pluginVersion,
  builtAt: now.toISOString(),
  config: loadConfig(projectRoot),
  tools: detectTools(projectRoot),
  atoms: readAtomIndex(pluginRoot),
})

export const readPlan = (projectRoot: string): Plan | undefined => {
  try {
    const value = JSON.parse(readFileSync(jigPaths(projectRoot).plan, 'utf8')) as Partial<Plan>
    return value.v === 1 && typeof value.inputsHash === 'string' ? (value as Plan) : undefined
  } catch {
    return undefined
  }
}

export const writePlan = (projectRoot: string, plan: Plan): void => {
  const path = jigPaths(projectRoot).plan
  mkdirSync(dirname(path), { recursive: true })
  writeFileAtomic(path, `${JSON.stringify(plan, null, 2)}\n`)
}

export const loadPlan = (projectRoot: string, pluginRoot: string): Plan => {
  const cached = readPlan(projectRoot)
  if (cached !== undefined && cached.inputsHash === planInputsHash(projectRoot, pluginRoot)) return cached
  const plan = buildPlan(projectRoot, pluginRoot)
  writePlan(projectRoot, plan)
  return plan
}
