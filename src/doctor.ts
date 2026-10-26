import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOG, type CatalogEntry } from './catalog'
import { AGENT_VIEW_CONFIG, agentViewCheck } from './catalog/proofs'
import { loadConfig, type LoadedConfig, type ToolSettings } from './core/config'
import { createMatcher } from './core/glob'
import { JOURNAL_MAX_BYTES, listJournalFiles } from './core/journal'
import { parseJsonc } from './core/jsonc'
import { jigPaths, resolvePluginRoot, resolveProjectRoot } from './core/paths'
import { resolveTools, type PlanTools } from './core/plan'
import { findInPath, findUnresolvedShim, isLockAbandoned, readLock } from './core/proc'
import { discover, projectFiles, type Discovery } from './init/discover'
import { detectAgent, isUserMapped, loadUserConfig, resolveTiers, tierEntries, UNKNOWN_AGENT } from './tiers/tiers'

type Command = (args: string[]) => number | Promise<number>

type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  status: Status
  text: string
  block?: string
}

const MIN_NODE_MAJOR = 20
const BYTES_PER_MB = 1024 * 1024
const STATUS_WIDTH = 4

const PROTECTED_FOR_DENY = [
  '.jig/config.jsonc',
  'eslint.config.*',
  'tsconfig*.json',
  '.oxlintrc.json',
  'stratum.config.jsonc',
  '.github/workflows/**',
  '.gitlab-ci.yml',
  '.husky/**',
] as const

const RECOMMENDED_DENY: readonly string[] = PROTECTED_FOR_DENY.map((path) => `Edit(${path})`)

const formatDenyBlock = (): string => {
  const rules = RECOMMENDED_DENY.map((rule) => `      "${rule}"`)
  return ['{', '  "permissions": {', '    "deny": [', rules.join(',\n'), '    ]', '  }', '}'].join('\n')
}

const ok = (text: string): Check => ({ status: 'ok', text })
const warn = (text: string): Check => ({ status: 'warn', text })
const fail = (text: string): Check => ({ status: 'fail', text })

const checkNode = (): Check => {
  const version = process.versions.node
  const major = Number(version.split('.')[0])
  return major >= MIN_NODE_MAJOR ? ok(`node: ${version}`) : fail(`node: ${version}, Node >= ${MIN_NODE_MAJOR} required`)
}

const NODE_NOT_ON_PATH =
  'node: not on PATH, so every hook (it runs a bare `node`) fails. An agent started from the macOS Dock or Finder gets the launchd PATH without nvm: start it from a terminal, or link node into /usr/local/bin'

/** The hooks run `node` from PATH, which may differ from the node running this command. */
const checkNodeOnPath = (env: NodeJS.ProcessEnv): Check | undefined => {
  const node = findInPath('node', env)
  if (node === undefined) return warn(NODE_NOT_ON_PATH)
  const version = spawnSync(node, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout?.trim().replace(/^v/, '') ?? ''
  const major = Number(version.split('.')[0])
  return major >= MIN_NODE_MAJOR ? undefined : warn(`node: ${node} on PATH is ${version || 'unknown'}, the hooks need Node >= ${MIN_NODE_MAJOR}`)
}

const checkConfig = (config: LoadedConfig): Check => {
  if (config.files.length === 0) return warn('config: no .jig/config.jsonc, no tool runs; run jig init')
  const files = config.files.join(' + ')
  return config.error === undefined ? ok(`config: ${files} valid`) : fail(`config: ${files} invalid: ${config.error}; run jig init --update`)
}

const checkTiers = (): Check => {
  const { label, config, error } = loadUserConfig()
  if (error !== undefined) return fail(`tiers: ${label}: ${error}`)
  const agent = detectAgent(undefined)
  const tiers = resolveTiers(agent, config)
  const source = isUserMapped(agent, config) ? label : 'built-in'
  if (tiers === undefined) return ok(`tiers: ${agent} no mapping`)
  const pairs = tierEntries(tiers).map(([tier, models]) => `${tier}=${models.join(',')}`)
  return ok(`tiers: ${agent} ${pairs.join(' ')} (${source})`)
}

const settingText = (setting: ToolSettings): string => {
  const parts = [setting.level, ...(setting.command === undefined ? [] : [`command "${setting.command}"`])]
  return setting.ignoreRules.length === 0 ? parts.join(', ') : `${parts.join(', ')}, ignores ${setting.ignoreRules.join(' ')}`
}

const checkCatalogEntry = (entry: CatalogEntry, config: LoadedConfig, tools: PlanTools, discovery: Discovery): Check => {
  const settings = entry.kind === 'tool' ? config.tools : config.proofs
  const setting = settings[entry.name]
  const found = discovery.found.find((item) => item.name === entry.name)
  if (setting === false) return ok(`${entry.name}: off in config`)
  if (setting === undefined) {
    return found?.status === 'ready' ? warn(`${entry.name}: found in the project, not in config; run jig init --update`) : ok(`${entry.name}: not used`)
  }
  const bins = entry.binaries.flatMap((binary) => tools[binary.key]?.bin ?? [])
  if (bins.length > 0) return ok(`${entry.name}: ${bins.join(' ')} (${settingText(setting)})`)
  if (setting.level === 'off') return ok(`${entry.name}: off in config`)
  const shim = entry.binaries.map((binary) => findUnresolvedShim(binary.command)).find((path) => path !== undefined)
  if (shim !== undefined) return warn(`${entry.name}: shim ${shim} has no recognizable target, tool not used`)
  return warn(`${entry.name}: on in config, binary not installed, tool not used`)
}

const hasUiFiles = (projectRoot: string): boolean => projectFiles(projectRoot).some(createMatcher(agentViewCheck.files))

const checkAgentViewSetup = (projectRoot: string, discovery: Discovery): Check | undefined => {
  const agentView = discovery.found.find((item) => item.name === agentViewCheck.name)
  if (agentView?.status === 'ready' || !hasUiFiles(projectRoot)) return undefined
  const setup = agentViewCheck.setup?.join(', then ') ?? 'agent-view init'
  return warn(`agent-view: no ${AGENT_VIEW_CONFIG}; UI changes cannot be proven in the running app. Set it up: ${setup}`)
}

const checkCustom = (config: LoadedConfig): Check[] =>
  config.checks.map((check) => ok(`check ${check.name}: on ${check.on}, ${check.level}, files ${check.files.join(' ')}, run ${check.run}`))

const checkGitignore = (projectRoot: string): Check => {
  const path = jigPaths(projectRoot).gitignore
  return existsSync(path) ? ok(`gitignore: ${path}`) : warn(`gitignore: ${path} missing, jig creates it on first run`)
}

const readDenyList = (path: string): string[] => {
  const settings = parseJsonc(readFileSync(path, 'utf8')) as { permissions?: { deny?: unknown } } | null
  const deny = settings?.permissions?.deny
  return Array.isArray(deny) ? deny.filter((entry): entry is string => typeof entry === 'string') : []
}

const checkDeny = (projectRoot: string): Check => {
  const path = join(projectRoot, '.claude', 'settings.json')
  let deny: string[] = []
  if (existsSync(path)) {
    try {
      deny = readDenyList(path)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { ...warn(`deny: ${path} unreadable (${reason}), add the recommended block:`), block: formatDenyBlock() }
    }
  }
  const missing = RECOMMENDED_DENY.filter((entry) => !deny.includes(entry))
  if (missing.length === 0) return ok(`deny: ${path} has the recommended block`)
  const text = `deny: ${path} misses ${missing.length} of ${RECOMMENDED_DENY.length} rules, add the recommended block:`
  return { ...warn(text), block: formatDenyBlock() }
}

const AGENTS_READING_CLAUDE_SETTINGS = new Set(['claude', UNKNOWN_AGENT])
const denyApplies = (agent: string): boolean => AGENTS_READING_CLAUDE_SETTINGS.has(agent)

const checkJournal = (projectRoot: string): Check => {
  const files = listJournalFiles(projectRoot)
  const bytes = files.reduce((total, file) => total + file.size, 0)
  const text = `journal: ${(bytes / BYTES_PER_MB).toFixed(1)} MB in ${files.length} files`
  return bytes > JOURNAL_MAX_BYTES ? warn(`${text}, above ${JOURNAL_MAX_BYTES / BYTES_PER_MB} MB`) : ok(text)
}

const checkLock = (path: string): Check => {
  if (!existsSync(path)) return ok(`lock: ${path} free`)
  if (isLockAbandoned(path)) return warn(`lock: ${path} abandoned, remove it`)
  const holder = readLock(path)
  return ok(`lock: ${path} held${holder === undefined ? '' : ` by pid ${holder.pid}`}`)
}

const formatCheck = (check: Check): string => {
  const line = `${check.status.padEnd(STATUS_WIDTH)} ${check.text}`
  return check.block === undefined ? line : `${line}\n${check.block}`
}

export const doctorChecks = (projectRoot: string, pluginRoot: string): Check[] => {
  const paths = jigPaths(projectRoot)
  const config = loadConfig(projectRoot)
  const { tools } = resolveTools(projectRoot, config)
  const discovery = discover(projectRoot)
  const agentViewSetup = checkAgentViewSetup(projectRoot, discovery)
  const nodeOnPath = checkNodeOnPath(process.env)
  return [
    checkNode(),
    ...(nodeOnPath === undefined ? [] : [nodeOnPath]),
    ok(`plugin: ${pluginRoot}`),
    ok(`project: ${projectRoot}`),
    checkConfig(config),
    checkTiers(),
    ...CATALOG.map((entry) => checkCatalogEntry(entry, config, tools, discovery)),
    ...(agentViewSetup === undefined ? [] : [agentViewSetup]),
    ...checkCustom(config),
    checkGitignore(projectRoot),
    ...(denyApplies(detectAgent(undefined)) ? [checkDeny(projectRoot)] : []),
    checkJournal(projectRoot),
    checkLock(paths.heavyLock),
    checkLock(join(paths.cache, 'slot.lock')),
  ]
}

export const runDoctor: Command = (args) => {
  if (args.length > 0) {
    throw new Error('usage: jig doctor')
  }
  const checks = doctorChecks(resolveProjectRoot(process.cwd()), resolvePluginRoot())
  process.stdout.write(`${checks.map(formatCheck).join('\n')}\n`)
  return checks.some((check) => check.status === 'fail') ? 1 : 0
}
