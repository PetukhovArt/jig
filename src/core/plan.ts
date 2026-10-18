import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { version as pluginVersion } from '../../package.json'
import { CHECKS } from '../checks'
import { TOOLS } from '../tools'
import type { PlanTools, ToolBinary, ToolEntry } from '../tools/tool'
import { loadConfig, type LoadedConfig } from './config'
import { parseFrontmatter } from './frontmatter'
import { jigPaths } from './paths'
import { resolveBin } from './proc'
import { writeFileAtomic } from './state'

export type { PlanTools, ToolBin, ToolEntry, ToolWithConfig } from '../tools/tool'

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

export const PLAN_BINARIES: readonly ToolBinary[] = [
  ...TOOLS.flatMap((tool) => tool.binaries),
  ...CHECKS.flatMap((check) => check.binaries),
]

const HASHED_INPUTS = [
  ...new Set(PLAN_BINARIES.flatMap((binary) => binary.configs)),
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

export const detectBinary = (projectRoot: string, binary: ToolBinary): ToolEntry | undefined => {
  const bin = resolveBin(projectRoot, binary.packages, binary.command)
  if (bin === undefined) return undefined
  if (!binary.requiresConfig) return { bin }
  const config = findConfig(projectRoot, binary.configs)
  return config === undefined ? undefined : { bin, config }
}

export const detectTools = (projectRoot: string): PlanTools => {
  const tools: PlanTools = {}
  for (const binary of PLAN_BINARIES) {
    const entry = detectBinary(projectRoot, binary)
    if (entry !== undefined) {
      tools[binary.key] = entry
    }
  }
  return tools
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
