import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Validator, childPath } from '../core/config'
import { parseJsonc } from '../core/jsonc'

type Command = (args: string[]) => number | Promise<number>

export const TIERS = ['deep', 'standard', 'fast'] as const
export type Tier = (typeof TIERS)[number]
export type TierMap = Partial<Record<Tier, string[]>>

export interface UserConfig {
  tiers: Record<string, TierMap>
}

export interface LoadedUserConfig {
  path: string
  label: string
  config: UserConfig
  error?: string
}

export const UNKNOWN_AGENT = 'unknown'

const USER_CONFIG_ENV = 'JIG_USER_CONFIG'
const DEFAULT_LABEL = '~/.jig/config.jsonc'
const AGENT_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const NO_MAPPING =
  'no mapping: choose a model that fits the tier (deep = strongest reasoning, standard = balanced, fast = cheap mechanical work)'

const DEFAULT_TIERS: Readonly<Record<string, TierMap>> = {
  claude: { deep: ['opus', 'sonnet'], standard: ['sonnet'], fast: ['haiku'] },
}

const AGENT_ENV: readonly { agent: string; vars: readonly string[] }[] = [
  { agent: 'claude', vars: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] },
  { agent: 'cursor', vars: ['CURSOR_AGENT', 'CURSOR_VERSION'] },
  { agent: 'codex', vars: ['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'] },
]

const emptyUserConfig = (): UserConfig => ({ tiers: {} })

const readModels = (validator: Validator, value: unknown, path: string): string[] | undefined => {
  const models = validator.strings(value, path)
  if (models === undefined) return undefined
  if (models.length === 0) return validator.report(path, 'expected a non-empty array of strings')
  const before = validator.errors.length
  models.forEach((model, index) => {
    if (model === '') {
      validator.report(childPath(path, index), 'expected a non-empty string')
    }
  })
  return validator.errors.length === before ? models : undefined
}

const readTierMap = (validator: Validator, value: unknown, path: string): TierMap | undefined => {
  const object = validator.object(value, path, TIERS)
  if (object === undefined) return undefined
  const map: TierMap = {}
  for (const tier of TIERS) {
    if (!Object.hasOwn(object, tier)) continue
    const models = readModels(validator, object[tier], childPath(path, tier))
    if (models !== undefined) {
      map[tier] = models
    }
  }
  return map
}

const readTiers = (validator: Validator, value: unknown): Record<string, TierMap> => {
  const path = '$.tiers'
  const object = validator.object(value, path, undefined)
  if (object === undefined) return {}
  const tiers: Record<string, TierMap> = {}
  for (const [agent, entry] of Object.entries(object)) {
    const agentPath = childPath(path, agent)
    if (!AGENT_ID.test(agent)) {
      validator.report(agentPath, 'expected a kebab-case agent id')
      continue
    }
    const map = readTierMap(validator, entry, agentPath)
    if (map !== undefined) {
      tiers[agent] = map
    }
  }
  return tiers
}

const validateUserConfig = (value: unknown): { config: UserConfig; errors: string[] } => {
  const validator = new Validator()
  const root = validator.object(value, '$', ['$schema', 'tiers'])
  if (root === undefined) return { config: emptyUserConfig(), errors: validator.errors }
  if (root['$schema'] !== undefined) {
    validator.string(root['$schema'], '$.$schema')
  }
  const tiers = root['tiers'] === undefined ? {} : readTiers(validator, root['tiers'])
  return { config: { tiers }, errors: validator.errors }
}

const parseUserConfig = (text: string): { config: UserConfig; error?: string } => {
  let value: unknown
  try {
    value = parseJsonc(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { config: emptyUserConfig(), error: `$: ${reason}` }
  }
  const { config, errors } = validateUserConfig(value)
  if (errors.length > 0) return { config: emptyUserConfig(), error: errors.join('; ') }
  return { config }
}

export const loadUserConfig = (env: NodeJS.ProcessEnv = process.env): LoadedUserConfig => {
  const override = env[USER_CONFIG_ENV]
  const path = override || join(homedir(), '.jig', 'config.jsonc')
  const label = override || DEFAULT_LABEL
  if (!existsSync(path)) return { path, label, config: emptyUserConfig() }
  return { path, label, ...parseUserConfig(readFileSync(path, 'utf8')) }
}

export const detectAgent = (flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string => {
  if (flag) return flag
  const match = AGENT_ENV.find(({ vars }) => vars.some((name) => Boolean(env[name])))
  return match?.agent ?? UNKNOWN_AGENT
}

export const resolveTiers = (agent: string, userConfig: UserConfig): TierMap | undefined => {
  const merged: TierMap = { ...DEFAULT_TIERS[agent], ...userConfig.tiers[agent] }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export const isUserMapped = (agent: string, userConfig: UserConfig): boolean => Object.hasOwn(userConfig.tiers, agent)

export const tierEntries = (tiers: TierMap): [Tier, string[]][] =>
  TIERS.flatMap((tier): [Tier, string[]][] => {
    const models = tiers[tier]
    return models === undefined ? [] : [[tier, models]]
  })

const formatTiers = (agent: string, tiers: TierMap | undefined): string => {
  const head = `agent: ${agent}`
  if (tiers === undefined) return `${head}\n${NO_MAPPING}`
  const lines = tierEntries(tiers).map(([tier, models]) => `${tier}: ${models.join(', ')}`)
  return [head, ...lines].join('\n')
}

export const runTiers: Command = (args) => {
  const { values } = parseArgs({ args, options: { agent: { type: 'string' }, json: { type: 'boolean' } }, strict: true })
  const loaded = loadUserConfig()
  if (loaded.error !== undefined) {
    throw new Error(`${loaded.label}: ${loaded.error}`)
  }
  const agent = detectAgent(values.agent)
  const tiers = resolveTiers(agent, loaded.config)
  const output = values.json ? JSON.stringify({ agent, tiers: tiers ?? null }) : formatTiers(agent, tiers)
  process.stdout.write(`${output}\n`)
  return 0
}
