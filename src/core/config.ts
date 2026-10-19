import { existsSync, readFileSync } from 'node:fs'
import { TOOLS, type GateRuleId } from '../tools'
import { parseJsonc } from './jsonc'
import { jigPaths } from './paths'

export const SEVERITIES = ['off', 'warn', 'error'] as const
export type Severity = (typeof SEVERITIES)[number]

export const JIG_RULE_IDS = ['jig/comments', 'jig/tests'] as const
export type RuleId = (typeof JIG_RULE_IDS)[number] | GateRuleId

export const RULE_IDS: readonly RuleId[] = [...JIG_RULE_IDS, ...TOOLS.map((tool) => tool.rule)]

export const DEFAULT_SEVERITY: Severity = 'error'

const DEFAULT_SEVERITIES: Partial<Record<RuleId, Severity>> = { 'jig/comments': 'off' }

const RUNTIMES = ['electron', 'tauri', 'browser', 'none'] as const
const VERIFY_RUNTIMES = ['electron', 'tauri', 'browser'] as const
const DEFAULT_PORT_TARGET = '.env'
const MAX_PORT = 65535

export interface PortConfig {
  base: number
  step: number
  target: string
}

export interface CdpConfig {
  base: number
  step: number
}

export interface SlotsConfig {
  worktreesDir: string
  install?: string
  dev?: string
  runtime?: (typeof RUNTIMES)[number]
  verifyRuntime?: (typeof VERIFY_RUNTIMES)[number]
  linkedPackages?: string[]
  ports?: Record<string, PortConfig>
  cdp?: CdpConfig
  instance?: Record<string, unknown>
  clearCache?: string[]
}

export interface WorktreeConfig {
  seedExclude?: string[]
  copyFiles?: string[]
}

export interface JigConfig {
  rules: Record<RuleId, Severity>
  slots?: SlotsConfig
  worktree?: WorktreeConfig
}

export interface LoadedConfig extends JigConfig {
  error?: string
}

type Json = Record<string, unknown>

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

export const childPath = (path: string, key: string | number): string => {
  if (typeof key === 'number') return `${path}[${key}]`
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class Validator {
  readonly errors: string[] = []

  report(path: string, problem: string): undefined {
    this.errors.push(`${path}: ${problem}`)
    return undefined
  }

  object(value: unknown, path: string, keys: readonly string[] | undefined): Json | undefined {
    if (!isObject(value)) return this.report(path, 'expected an object')
    if (keys === undefined) return value
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        this.report(childPath(path, key), 'unknown key')
      }
    }
    return value
  }

  string(value: unknown, path: string): string | undefined {
    return typeof value === 'string' ? value : this.report(path, 'expected a string')
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | undefined {
    const isAllowed = typeof value === 'string' && (allowed as readonly string[]).includes(value)
    return isAllowed ? (value as T) : this.report(path, `expected one of ${allowed.join(', ')}`)
  }

  integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
    const isInRange = Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    if (isInRange) return value as number
    const range = max === Number.MAX_SAFE_INTEGER ? `>= ${min}` : `${min}..${max}`
    return this.report(path, `expected an integer ${range}`)
  }

  strings(value: unknown, path: string): string[] | undefined {
    if (!Array.isArray(value)) return this.report(path, 'expected an array of strings')
    const before = this.errors.length
    value.forEach((item, index) => this.string(item, childPath(path, index)))
    return this.errors.length === before ? (value as string[]) : undefined
  }
}

const required = (validator: Validator, object: Json, path: string, keys: readonly string[]): boolean => {
  const missing = keys.filter((key) => !Object.hasOwn(object, key))
  missing.forEach((key) => validator.report(childPath(path, key), 'is required'))
  return missing.length === 0
}

const readRules = (validator: Validator, value: unknown): Record<RuleId, Severity> => {
  const rules = defaultRules()
  if (value === undefined) return rules
  const object = validator.object(value, '$.rules', RULE_IDS)
  if (object === undefined) return rules
  for (const rule of RULE_IDS) {
    if (!Object.hasOwn(object, rule)) continue
    const severity = validator.oneOf(object[rule], childPath('$.rules', rule), SEVERITIES)
    if (severity !== undefined) {
      rules[rule] = severity
    }
  }
  return rules
}

const readStep = (validator: Validator, value: unknown, path: string, keys: readonly string[]): Json | undefined => {
  const object = validator.object(value, path, keys)
  if (object === undefined || !required(validator, object, path, ['base', 'step'])) return undefined
  validator.integer(object['base'], childPath(path, 'base'), 1, MAX_PORT)
  validator.integer(object['step'], childPath(path, 'step'), 1)
  return object
}

const readPorts = (validator: Validator, value: unknown, path: string): Record<string, PortConfig> | undefined => {
  const object = validator.object(value, path, undefined)
  if (object === undefined) return undefined
  const ports: Record<string, PortConfig> = {}
  for (const [key, entry] of Object.entries(object)) {
    const portPath = childPath(path, key)
    const port = readStep(validator, entry, portPath, ['base', 'step', 'target'])
    if (port === undefined) continue
    const target = port['target'] === undefined ? DEFAULT_PORT_TARGET : validator.string(port['target'], childPath(portPath, 'target'))
    ports[key] = { base: port['base'] as number, step: port['step'] as number, target: target ?? DEFAULT_PORT_TARGET }
  }
  return ports
}

const SLOT_KEYS = [
  'worktreesDir',
  'install',
  'dev',
  'runtime',
  'verifyRuntime',
  'linkedPackages',
  'ports',
  'cdp',
  'instance',
  'clearCache',
] as const

const readSlots = (validator: Validator, value: unknown): SlotsConfig | undefined => {
  const path = '$.slots'
  const object = validator.object(value, path, SLOT_KEYS)
  if (object === undefined || !required(validator, object, path, ['worktreesDir'])) return undefined
  const at = (key: string): string => childPath(path, key)
  const slots: SlotsConfig = { worktreesDir: validator.string(object['worktreesDir'], at('worktreesDir')) ?? '' }
  const readers: Record<Exclude<(typeof SLOT_KEYS)[number], 'worktreesDir'>, (raw: unknown) => unknown> = {
    install: (raw) => validator.string(raw, at('install')),
    dev: (raw) => validator.string(raw, at('dev')),
    runtime: (raw) => validator.oneOf(raw, at('runtime'), RUNTIMES),
    verifyRuntime: (raw) => validator.oneOf(raw, at('verifyRuntime'), VERIFY_RUNTIMES),
    linkedPackages: (raw) => validator.strings(raw, at('linkedPackages')),
    ports: (raw) => readPorts(validator, raw, at('ports')),
    cdp: (raw) => readStep(validator, raw, at('cdp'), ['base', 'step']),
    instance: (raw) => validator.object(raw, at('instance'), undefined),
    clearCache: (raw) => validator.strings(raw, at('clearCache')),
  }
  for (const [key, read] of Object.entries(readers)) {
    if (!Object.hasOwn(object, key)) continue
    const parsed = read(object[key])
    if (parsed !== undefined) {
      Object.assign(slots, { [key]: parsed })
    }
  }
  return slots
}

const WORKTREE_KEYS = ['seedExclude', 'copyFiles'] as const

const readWorktree = (validator: Validator, value: unknown): WorktreeConfig | undefined => {
  const path = '$.worktree'
  const object = validator.object(value, path, WORKTREE_KEYS)
  if (object === undefined) return undefined
  const worktree: WorktreeConfig = {}
  for (const key of WORKTREE_KEYS) {
    if (object[key] === undefined) continue
    const parsed = validator.strings(object[key], childPath(path, key))
    if (parsed !== undefined) {
      worktree[key] = parsed
    }
  }
  return worktree
}

export const defaultRules = (): Record<RuleId, Severity> =>
  Object.fromEntries(RULE_IDS.map((rule) => [rule, DEFAULT_SEVERITIES[rule] ?? DEFAULT_SEVERITY])) as Record<RuleId, Severity>

export const defaultConfig = (): JigConfig => ({ rules: defaultRules() })

export const validateConfig = (value: unknown): { config: JigConfig; errors: string[] } => {
  const validator = new Validator()
  const root = validator.object(value, '$', ['$schema', 'rules', 'slots', 'worktree'])
  if (root === undefined) return { config: defaultConfig(), errors: validator.errors }
  if (root['$schema'] !== undefined) {
    validator.string(root['$schema'], '$.$schema')
  }
  const rules = readRules(validator, root['rules'])
  const slots = root['slots'] === undefined ? undefined : readSlots(validator, root['slots'])
  const worktree = root['worktree'] === undefined ? undefined : readWorktree(validator, root['worktree'])
  const config: JigConfig = {
    rules,
    ...(slots === undefined ? {} : { slots }),
    ...(worktree === undefined ? {} : { worktree }),
  }
  return { config, errors: validator.errors }
}

export const parseConfig = (text: string): LoadedConfig => {
  let value: unknown
  try {
    value = parseJsonc(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ...defaultConfig(), error: `$: ${reason}` }
  }
  const { config, errors } = validateConfig(value)
  if (errors.length > 0) return { ...defaultConfig(), error: errors.join('; ') }
  return config
}

export const loadConfig = (projectRoot: string): LoadedConfig => {
  const { config } = jigPaths(projectRoot)
  if (!existsSync(config)) return defaultConfig()
  return parseConfig(readFileSync(config, 'utf8'))
}
