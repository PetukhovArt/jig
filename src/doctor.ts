import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './core/config'
import { gitLsFiles } from './core/git'
import { JOURNAL_MAX_BYTES, listJournalFiles } from './core/journal'
import { parseJsonc } from './core/jsonc'
import { jigPaths, resolvePluginRoot, resolveProjectRoot } from './core/paths'
import {
  AGENT_VIEW_CONFIG,
  ESLINT_CONFIGS,
  OXLINT_CONFIGS,
  STRATUM_CONFIG,
  TSCONFIG,
  detectTools,
  readAtomIndex,
  type PlanTools,
} from './core/plan'
import { createMatcher } from './core/glob'
import { findUnresolvedShim, isLockAbandoned, readLock } from './core/proc'
import { detectAgent, isUserMapped, loadUserConfig, resolveTiers, tierEntries } from './tiers/tiers'

type Command = (args: string[]) => number | Promise<number>

type Status = 'ok' | 'warn' | 'fail'

interface Check {
  status: Status
  text: string
  block?: string
}

interface ToolSpec {
  key: keyof PlanTools
  label: string
  command: string
  configs: readonly string[]
}

const MIN_NODE_MAJOR = 20
const BYTES_PER_MB = 1024 * 1024
const STATUS_WIDTH = 4

const TOOLS: readonly ToolSpec[] = [
  { key: 'oxlint', label: 'oxlint', command: 'oxlint', configs: OXLINT_CONFIGS },
  { key: 'eslint', label: 'eslint', command: 'eslint', configs: ESLINT_CONFIGS },
  { key: 'tsc', label: 'tsc', command: 'tsc', configs: [TSCONFIG] },
  { key: 'vueTsc', label: 'vue-tsc', command: 'vue-tsc', configs: [] },
  { key: 'stratum', label: 'stratum', command: 'stratum-lint', configs: [STRATUM_CONFIG] },
  { key: 'agentView', label: 'agent-view', command: 'agent-view', configs: [AGENT_VIEW_CONFIG] },
]

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

const RECOMMENDED_DENY: readonly string[] = PROTECTED_FOR_DENY.flatMap((path) => [`Edit(${path})`, `Write(${path})`])

const formatDenyBlock = (): string => {
  const pairs = PROTECTED_FOR_DENY.map((path) => `      "Edit(${path})", "Write(${path})"`)
  return ['{', '  "permissions": {', '    "deny": [', pairs.join(',\n'), '    ]', '  }', '}'].join('\n')
}

const ok = (text: string): Check => ({ status: 'ok', text })
const warn = (text: string): Check => ({ status: 'warn', text })
const fail = (text: string): Check => ({ status: 'fail', text })

const checkNode = (): Check => {
  const version = process.versions.node
  const major = Number(version.split('.')[0])
  return major >= MIN_NODE_MAJOR ? ok(`node: ${version}`) : fail(`node: ${version}, Node >= ${MIN_NODE_MAJOR} required`)
}

const checkConfig = (projectRoot: string): Check => {
  const path = jigPaths(projectRoot).config
  if (!existsSync(path)) return ok(`config: ${path} absent, defaults apply`)
  const { error } = loadConfig(projectRoot)
  return error === undefined ? ok(`config: ${path} valid`) : fail(`config: ${path} invalid: ${error}`)
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

const firstExisting =(projectRoot: string, names: readonly string[]): string | undefined =>
  names.map((name) => join(projectRoot, name)).find((path) => existsSync(path))

const checkTool = (projectRoot: string, tools: PlanTools, spec: ToolSpec): Check => {
  const found = tools[spec.key]
  if (found !== undefined) {
    const config = 'config' in found ? ` config ${found.config}` : ''
    return ok(`${spec.label}: ${found.bin.join(' ')}${config}`)
  }
  const shim = findUnresolvedShim(spec.command)
  if (shim !== undefined) return warn(`${spec.label}: shim ${shim} has no recognizable target, tool not used`)
  const config = firstExisting(projectRoot, spec.configs)
  if (config === undefined) return ok(`${spec.label}: not used`)
  return warn(`${spec.label}: ${config} found, binary not found, tool not used`)
}

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

const checkAtomPaths = (projectRoot: string, pluginRoot: string): Check[] => {
  const files = gitLsFiles(projectRoot)
  const checks: Check[] = []
  let globs = 0
  for (const atom of readAtomIndex(pluginRoot)) {
    for (const glob of atom.paths ?? []) {
      globs++
      const matches = createMatcher([glob])
      if (!files.some(matches)) {
        checks.push(warn(`atom ${atom.name}: paths glob ${glob} matches no file`))
      }
    }
  }
  return checks.length > 0 ? checks : [ok(`atoms: ${globs} paths globs match files`)]
}

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

export const runDoctor: Command = (args) => {
  if (args.length > 0) {
    throw new Error('usage: jig doctor')
  }
  const projectRoot = resolveProjectRoot(process.cwd())
  const pluginRoot = resolvePluginRoot()
  const paths = jigPaths(projectRoot)
  const tools = detectTools(projectRoot)
  const checks: Check[] = [
    checkNode(),
    ok(`plugin: ${pluginRoot}`),
    ok(`project: ${projectRoot}`),
    checkConfig(projectRoot),
    checkTiers(),
    ...TOOLS.map((spec) => checkTool(projectRoot, tools, spec)),
    checkGitignore(projectRoot),
    checkDeny(projectRoot),
    ...checkAtomPaths(projectRoot, pluginRoot),
    checkJournal(projectRoot),
    checkLock(paths.heavyLock),
    checkLock(join(paths.cache, 'slot.lock')),
  ]
  process.stdout.write(`${checks.map(formatCheck).join('\n')}\n`)
  return checks.some((check) => check.status === 'fail') ? 1 : 0
}
