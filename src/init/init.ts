import { existsSync, readFileSync } from 'node:fs'
import { catalogEntry, CATALOG } from '../catalog'
import { loadConfig, type LoadedConfig } from '../core/config'
import { parseJsonc } from '../core/jsonc'
import { jigPaths, resolveProjectRoot } from '../core/paths'
import { configDrift, resolveTools } from '../core/plan'
import { discover, isListed, type Discovery, type Found } from './discover'

type Command = (args: string[]) => number | Promise<number>

export const SCHEMA_URL = 'https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json'
export const BOUNDARIES_PLUGIN = 'eslint-plugin-boundaries'
export const BOUNDARIES_IGNORE = 'boundaries/*'

const USAGE = 'usage: jig init [--update] [--json]'
const EXIT_USAGE = 2
const NAME_WIDTH = 12

type Json = Record<string, unknown>

export interface InitReport {
  update: boolean
  discovery: Discovery
  boundaries: boolean
  drift: string[]
  questions: string[]
  proposal: Json
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const readSharedConfig = (projectRoot: string): Json => {
  const path = jigPaths(projectRoot).config
  if (!existsSync(path)) return {}
  try {
    const value = parseJsonc(readFileSync(path, 'utf8'))
    return isObject(value) ? value : {}
  } catch {
    return {}
  }
}

const proposedSetting = (found: Found): Json => (found.command === undefined ? {} : { command: found.command })

const section = (base: Json, key: string): Json => (isObject(base[key]) ? { ...(base[key] as Json) } : {})

/** The explicit config jig would write: the current one (with --update) plus every ready catalog entry it does not name. */
export const buildProposal = (base: Json, discovery: Discovery, config: Pick<LoadedConfig, 'tools' | 'proofs'>): Json => {
  const tools = section(base, 'tools')
  const proofs = section(base, 'proofs')
  for (const found of discovery.found) {
    if (found.status !== 'ready' || isListed(config, found)) continue
    const target = found.kind === 'tool' ? tools : proofs
    target[found.name] = proposedSetting(found)
  }
  const rules = { 'jig/comments': 'error', ...section(base, 'rules') }
  return { $schema: SCHEMA_URL, ...base, rules, tools, proofs }
}

const questionsFor = (discovery: Discovery, boundaries: boolean): string[] => {
  const byName = new Map(discovery.found.map((found) => [found.name, found]))
  const setupOf = (name: string): string => catalogEntry(name)?.setup.join(', then ') ?? ''
  const questions = [
    'App run command (slots.dev) and install command (slots.install), if the project runs an app.',
    'Comment gate (rules["jig/comments"]): enable (default) or off.',
  ]
  const agentView = byName.get('agent-view')
  const agentViewState = agentView === undefined ? 'not installed' : agentView.status === 'ready' ? 'configured' : 'installed, no agent-view.config.json'
  questions.push(`agent-view for UI proof (${agentViewState}): needed? Setup: ${setupOf('agent-view')}.`)
  const stratum = byName.get('stratum')
  const stratumState = stratum === undefined ? 'not installed' : stratum.status === 'ready' ? 'configured' : 'installed, no stratum.config.jsonc'
  const port = boundaries ? ` ${BOUNDARIES_PLUGIN} is present: port its rules to stratum, then tools.eslint.ignoreRules ["${BOUNDARIES_IGNORE}"].` : ''
  questions.push(`stratum for module layers (${stratumState}): needed? Setup: ${setupOf('stratum')}.${port}`)
  return questions
}

export const buildInitReport = (projectRoot: string, update: boolean): InitReport => {
  const discovery = discover(projectRoot)
  const config = loadConfig(projectRoot)
  const base = update ? readSharedConfig(projectRoot) : {}
  const boundaries = discovery.packages.includes(BOUNDARIES_PLUGIN)
  const drift = update ? configDrift(projectRoot, config, resolveTools(projectRoot, config).unresolved) : []
  const listed = update ? config : { tools: {}, proofs: {} }
  return { update, discovery, boundaries, drift, questions: questionsFor(discovery, boundaries), proposal: buildProposal(base, discovery, listed) }
}

const foundLine = (found: Found): string => {
  const facts = [
    found.status === 'ready' ? 'ready' : 'needs setup',
    found.markers.length > 0 ? `markers ${found.markers.join(', ')}` : 'no marker config',
    ...(found.packages.length > 0 ? [`packages ${found.packages.join(', ')}`] : []),
    ...(found.command === undefined ? [] : [`command ${found.command}`]),
    found.bin === undefined ? 'binary not installed' : `binary ${found.bin.join(' ')}`,
    ...(found.status === 'needs-setup' && found.setup.length > 0 ? [`setup: ${found.setup.join(', then ')}`] : []),
  ]
  return `  ${found.name.padEnd(NAME_WIDTH)} ${facts.join('; ')}`
}

export const formatInitReport = (report: InitReport): string => {
  const foundNames = new Set(report.discovery.found.map((found) => found.name))
  const missing = CATALOG.filter((entry) => !foundNames.has(entry.name)).map((entry) => entry.name)
  const lines = [
    `jig init${report.update ? ' --update' : ''}: discovery by the jig catalog; nothing is written.`,
    '',
    'found:',
    ...report.discovery.found.map(foundLine),
    ...(missing.length > 0 ? [`not found: ${missing.join(', ')}`] : []),
    `${BOUNDARIES_PLUGIN}: ${report.boundaries ? 'declared in package.json' : 'absent'}`,
  ]
  if (report.update) {
    lines.push('', 'drift:', ...(report.drift.length > 0 ? report.drift.map((reason) => `  ${reason}`) : ['  none']))
  }
  lines.push('', 'ask the user (code cannot know):', ...report.questions.map((question) => `  - ${question}`))
  lines.push('', 'proposal for .jig/config.jsonc:', JSON.stringify(report.proposal, null, 2))
  return `${lines.join('\n')}\n`
}

export const runInit: Command = (args) => {
  const unknown = args.filter((arg) => arg !== '--update' && arg !== '--json')
  if (unknown.length > 0) {
    process.stderr.write(`jig: ${USAGE}\n`)
    return EXIT_USAGE
  }
  const report = buildInitReport(resolveProjectRoot(process.cwd()), args.includes('--update'))
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatInitReport(report))
  return 0
}
