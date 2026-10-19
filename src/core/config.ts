import { existsSync, readFileSync } from 'node:fs'
import { OUTPUT_FORMATS, EXIT_FORMAT, PROOF_NAMES, TOOL_NAMES } from '../catalog'
import { parseJsonc } from './jsonc'
import { jigPaths } from './paths'

export const SEVERITIES = ['off', 'warn', 'error'] as const
export type Severity = (typeof SEVERITIES)[number]

export const JIG_RULE_IDS = ['jig/comments', 'jig/tests', 'jig/todos'] as const
export type JigRuleId = (typeof JIG_RULE_IDS)[number]
export type RuleId = JigRuleId | `gate/${string}` | `check/${string}`

export const RULE_IDS: readonly JigRuleId[] = JIG_RULE_IDS

export const DEFAULT_SEVERITY: Severity = 'error'

const DEFAULT_SEVERITIES: Partial<Record<JigRuleId, Severity>> = {}

export interface ToolSettings {
  level: Severity
  command?: string
  ignoreRules: string[]
}

export type ToolSetting = ToolSettings | false

export const CHECK_STAGES = ['edit', 'stop'] as const
export type CheckStage = (typeof CHECK_STAGES)[number]

export interface CustomCheck {
  name: string
  files: string[]
  on: CheckStage
  run: string
  format: string
  level: Severity
}

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
  rules: Record<JigRuleId, Severity>
  tools: Record<string, ToolSetting>
  proofs: Record<string, ToolSetting>
  checks: CustomCheck[]
  slots?: SlotsConfig
  worktree?: WorktreeConfig
}

export interface LoadedConfig extends JigConfig {
  files: string[]
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

const TOOL_KEYS = ['level', 'command', 'ignoreRules'] as const

const readToolSetting = (validator: Validator, value: unknown, path: string): ToolSetting | undefined => {
  if (value === false) return false
  const object = validator.object(value, path, TOOL_KEYS)
  if (object === undefined) return undefined
  const setting: ToolSettings = { level: DEFAULT_SEVERITY, ignoreRules: [] }
  if (object['level'] !== undefined) {
    setting.level = validator.oneOf(object['level'], childPath(path, 'level'), SEVERITIES) ?? DEFAULT_SEVERITY
  }
  if (object['command'] !== undefined) {
    const command = validator.string(object['command'], childPath(path, 'command'))
    if (command !== undefined && command.trim() === '') validator.report(childPath(path, 'command'), 'is empty')
    else if (command !== undefined) setting.command = command
  }
  if (object['ignoreRules'] !== undefined) {
    setting.ignoreRules = validator.strings(object['ignoreRules'], childPath(path, 'ignoreRules')) ?? []
  }
  return setting
}

const readNamed = (validator: Validator, root: Json, names: readonly string[]): Record<string, ToolSetting> => {
  const settings: Record<string, ToolSetting> = {}
  for (const name of names) {
    if (!Object.hasOwn(root, name)) continue
    const setting = readToolSetting(validator, root[name], childPath('$', name))
    if (setting !== undefined) {
      settings[name] = setting
    }
  }
  return settings
}

const readGlobs = (validator: Validator, value: unknown, path: string): string[] | undefined =>
  typeof value === 'string' ? [value] : validator.strings(value, path)

const CHECK_KEYS = ['name', 'files', 'on', 'run', 'format', 'level'] as const
const CHECK_NAME = /^[\w.-]+$/
const FILES_TOKEN = '{files}'

const readCheck = (validator: Validator, value: unknown, path: string): CustomCheck | undefined => {
  const object = validator.object(value, path, CHECK_KEYS)
  if (object === undefined || !required(validator, object, path, ['name', 'files', 'on', 'run'])) return undefined
  const before = validator.errors.length
  const name = validator.string(object['name'], childPath(path, 'name'))
  if (name !== undefined && !CHECK_NAME.test(name)) validator.report(childPath(path, 'name'), 'expected letters, digits, ".", "_" or "-"')
  const files = readGlobs(validator, object['files'], childPath(path, 'files'))
  const on = validator.oneOf(object['on'], childPath(path, 'on'), CHECK_STAGES)
  const run = validator.string(object['run'], childPath(path, 'run'))
  if (run !== undefined && !run.includes(FILES_TOKEN)) validator.report(childPath(path, 'run'), `needs the ${FILES_TOKEN} placeholder`)
  const format = object['format'] === undefined ? EXIT_FORMAT : validator.oneOf(object['format'], childPath(path, 'format'), OUTPUT_FORMATS)
  const level = object['level'] === undefined ? DEFAULT_SEVERITY : validator.oneOf(object['level'], childPath(path, 'level'), SEVERITIES)
  const isValid = validator.errors.length === before
  if (!isValid || name === undefined || files === undefined || on === undefined || run === undefined || format === undefined || level === undefined) {
    return undefined
  }
  return { name, files, on, run, format, level }
}

const readChecks = (validator: Validator, value: unknown): CustomCheck[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return validator.report('$.checks', 'expected an array') ?? []
  const checks: CustomCheck[] = []
  value.forEach((entry, index) => {
    const path = childPath('$.checks', index)
    const check = readCheck(validator, entry, path)
    if (check === undefined) return
    if (checks.some((other) => other.name === check.name)) {
      validator.report(childPath(path, 'name'), `duplicate check ${check.name}`)
      return
    }
    checks.push(check)
  })
  return checks
}

const readRules = (validator: Validator, value: unknown): Record<JigRuleId, Severity> => {
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


export const defaultRules = (): Record<JigRuleId, Severity> => {
  const rules = {} as Record<JigRuleId, Severity>
  for (const rule of RULE_IDS) {
    rules[rule] = DEFAULT_SEVERITIES[rule] ?? DEFAULT_SEVERITY
  }
  return rules
}

export const defaultConfig = (): JigConfig => ({ rules: defaultRules(), tools: {}, proofs: {}, checks: [] })

const SECTION_KEYS = ['$schema', 'rules', 'checks', 'slots', 'worktree'] as const

/** Root keys: the fixed sections plus every catalog name, so a tool outside the catalog is an unknown key. */
export const ROOT_KEYS: readonly string[] = [...SECTION_KEYS, ...TOOL_NAMES, ...PROOF_NAMES]

export const validateConfig = (value: unknown): { config: JigConfig; errors: string[] } => {
  const validator = new Validator()
  const root = validator.object(value, '$', ROOT_KEYS)
  if (root === undefined) return { config: defaultConfig(), errors: validator.errors }
  if (root['$schema'] !== undefined) {
    validator.string(root['$schema'], '$.$schema')
  }
  const rules = readRules(validator, root['rules'])
  const tools = readNamed(validator, root, TOOL_NAMES)
  const proofs = readNamed(validator, root, PROOF_NAMES)
  const checks = readChecks(validator, root['checks'])
  const slots = root['slots'] === undefined ? undefined : readSlots(validator, root['slots'])
  const worktree = root['worktree'] === undefined ? undefined : readWorktree(validator, root['worktree'])
  const config: JigConfig = {
    rules,
    tools,
    proofs,
    checks,
    ...(slots === undefined ? {} : { slots }),
    ...(worktree === undefined ? {} : { worktree }),
  }
  return { config, errors: validator.errors }
}

const mergeChecks = (shared: unknown, local: unknown): unknown => {
  if (!Array.isArray(shared) || !Array.isArray(local)) return local
  const nameOf = (entry: unknown): string | undefined => {
    const name = isObject(entry) ? entry['name'] : undefined
    return typeof name === 'string' ? name : undefined
  }
  const localNames = new Set(local.map(nameOf).filter((name) => name !== undefined))
  return [...shared.filter((entry) => !localNames.has(nameOf(entry) ?? '')), ...local]
}

/**
 * Local config over shared: objects merge key by key, `checks` merge by name, any other value
 * (an array, a scalar, `false`) replaces the shared one.
 */
export const mergeConfigValues = (shared: unknown, local: unknown, path = '$'): unknown => {
  if (path === '$.checks') return mergeChecks(shared, local)
  if (!isObject(shared) || !isObject(local)) return local
  const merged: Json = { ...shared }
  for (const [key, value] of Object.entries(local)) {
    merged[key] = Object.hasOwn(shared, key) ? mergeConfigValues(shared[key], value, childPath(path, key)) : value
  }
  return merged
}

const failed = (files: string[], error: string): LoadedConfig => ({ ...defaultConfig(), files, error })

const parseText = (text: string, label: string): { value: unknown } | { error: string } => {
  try {
    return { value: parseJsonc(text) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { error: `${label}$: ${reason}` }
  }
}

const loadValue = (value: unknown, files: string[]): LoadedConfig => {
  const { config, errors } = validateConfig(value)
  if (errors.length > 0) return failed(files, errors.join('; '))
  return { ...config, files }
}

export const parseConfig = (text: string): LoadedConfig => {
  const parsed = parseText(text, '')
  return 'error' in parsed ? failed([], parsed.error) : loadValue(parsed.value, [])
}

const readOptional = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)

export const loadConfig = (projectRoot: string): LoadedConfig => {
  const paths = jigPaths(projectRoot)
  const sources = [
    { path: paths.config, label: '.jig/config.jsonc: ' },
    { path: paths.localConfig, label: '.jig/config.local.jsonc: ' },
  ].flatMap((source) => {
    const text = readOptional(source.path)
    return text === undefined ? [] : [{ ...source, text }]
  })
  const files = sources.map((source) => source.path)
  if (sources.length === 0) return { ...defaultConfig(), files }
  let merged: unknown = {}
  for (const source of sources) {
    const parsed = parseText(source.text, source.label)
    if ('error' in parsed) return failed(files, parsed.error)
    merged = mergeConfigValues(merged, parsed.value)
  }
  return loadValue(merged, files)
}

export const enabledSetting = (settings: Readonly<Record<string, ToolSetting>>, name: string): ToolSettings | undefined => {
  const setting = settings[name]
  return setting === undefined || setting === false || setting.level === 'off' ? undefined : setting
}
