import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { version as pluginVersion } from '../../package.json'
import { ALL_MARKERS, catalogEntry, LOCKFILES } from '../catalog'
import { discover, unlisted } from '../init/discover'
import type { PlanTools } from '../tools/tool'
import { splitCommand } from './command'
import { enabledSetting, loadConfig, type JigConfig, type LoadedConfig } from './config'
import { parseFrontmatter, type FrontmatterValue } from './frontmatter'
import { jigPaths } from './paths'
import { resolveBin } from './proc'
import { writeFileAtomic } from './state'

export type { PlanTools, ToolBin, ToolEntry, ToolWithConfig } from '../tools/tool'

export const PLAN_VERSION = 2

export interface PlanAtom {
  name: string
  description: string
  file: string
}

export interface Plan {
  v: typeof PLAN_VERSION
  inputsHash: string
  pluginVersion: string
  builtAt: string
  config: LoadedConfig
  tools: PlanTools
  unresolved: string[]
  drift: string[]
  atoms: PlanAtom[]
}

const HASHED_INPUTS = [
  '.jig/config.jsonc',
  '.jig/config.local.jsonc',
  'package.json',
  'node_modules/.package-lock.json',
  ...LOCKFILES.map((lockfile) => lockfile.file),
  ...ALL_MARKERS,
]

const fileStamp = (path: string): string => {
  try {
    const stat = statSync(path)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'missing'
  }
}

export const planInputsHash = (projectRoot: string, pluginRoot: string): string => {
  const lines = [`version:${pluginVersion}`, `plugin:${pluginRoot}`, ...HASHED_INPUTS.map((name) => `${name}:${fileStamp(join(projectRoot, name))}`)]
  return createHash('sha1').update(lines.join('\n')).digest('hex')
}

export interface ResolvedTools {
  tools: PlanTools
  unresolved: string[]
}

/** Resolves the binary of every tool and proof the config turns on; nothing outside the config runs. */
export const resolveTools = (projectRoot: string, config: Pick<JigConfig, 'tools' | 'proofs'>): ResolvedTools => {
  const tools: PlanTools = {}
  const unresolved: string[] = []
  const named = [...Object.keys(config.tools).map((name) => [name, config.tools] as const), ...Object.keys(config.proofs).map((name) => [name, config.proofs] as const)]
  for (const [name, settings] of named) {
    const setting = enabledSetting(settings, name)
    const entry = catalogEntry(name)
    const [primary] = entry?.binaries ?? []
    if (setting === undefined || entry === undefined || primary === undefined) continue
    const [command = primary.command, ...args] = splitCommand(setting.command ?? primary.command)
    const binary = entry.binaries.find((candidate) => candidate.command === command)
    const bin = resolveBin(projectRoot, binary?.packages ?? [], command)
    if (bin === undefined) {
      unresolved.push(name)
      continue
    }
    tools[(binary ?? primary).key] = { bin: [...bin, ...args] }
  }
  return { tools, unresolved }
}

/** Why the project and its config disagree; empty when they agree. Read at session start, written by `jig init --update`. */
export const configDrift = (projectRoot: string, config: LoadedConfig, unresolved: readonly string[]): string[] => {
  if (config.error !== undefined) return [`.jig config is invalid (${config.error})`]
  const found = unlisted(config, discover(projectRoot)).map((item) => item.name)
  if (config.files.length === 0) return found.length === 0 ? [] : [`no .jig/config.jsonc, found ${found.join(', ')}`]
  return [
    ...found.map((name) => `found ${name}, not in config`),
    ...unresolved.map((name) => `${name} is on in config, its binary is not installed`),
  ]
}

/** The one session-start line about drift, naming the command that settles it. */
export const configDriftLine = (plan: Pick<Plan, 'drift' | 'config'>): string | undefined => {
  if (plan.drift.length === 0) return undefined
  const command = plan.config.files.length > 0 ? 'jig init --update' : 'jig init'
  return `jig: ${plan.drift.join('; ')}. Run ${command} to settle the project config.`
}

const toPlanAtom =(file: string): PlanAtom | undefined => {
  let data: Record<string, FrontmatterValue>
  try {
    data = parseFrontmatter(readFileSync(file, 'utf8'))?.data ?? {}
  } catch {
    return undefined
  }
  const { name, description } = data
  const isIndexable = typeof name === 'string' && typeof description === 'string'
  return isIndexable ? { name, description, file } : undefined
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

export const buildPlan = (projectRoot: string, pluginRoot: string, now: Date = new Date()): Plan => {
  const config = loadConfig(projectRoot)
  const { tools, unresolved } = resolveTools(projectRoot, config)
  return {
    v: PLAN_VERSION,
    inputsHash: planInputsHash(projectRoot, pluginRoot),
    pluginVersion,
    builtAt: now.toISOString(),
    config,
    tools,
    unresolved,
    drift: configDrift(projectRoot, config, unresolved),
    atoms: readAtomIndex(pluginRoot),
  }
}

export const readPlan = (projectRoot: string): Plan | undefined => {
  try {
    const value = JSON.parse(readFileSync(jigPaths(projectRoot).plan, 'utf8')) as Partial<Plan>
    return value.v === PLAN_VERSION && typeof value.inputsHash === 'string' ? (value as Plan) : undefined
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
