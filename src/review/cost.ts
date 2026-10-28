import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { git } from '../core/git'
import { toSlash } from '../core/paths'
import { loadUserConfig, type Price } from '../tiers/tiers'
import { listWorktrees } from '../worktree/list'
import { exclusionOf, parseNumstat } from './review-plan'

type Command = (args: string[]) => number

export const DEFAULT_PRICES: Readonly<Record<string, Price>> = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
}

export const CACHE_MULTIPLIERS = { write5m: 1.25, write1h: 2, read: 0.1 } as const

export const ROLES = ['runner', 'finder', 'judge', 'deepener', 'outcome', 'poster', 'other'] as const
export type Role = (typeof ROLES)[number]

const ROLE_PATTERNS: readonly [Role, RegExp][] = [
  ['runner', /^review\b|review runner/i],
  ['finder', /^finder\b/i],
  ['deepener', /deepen/i],
  ['outcome', /outcome/i],
  ['judge', /judge|verif/i],
  ['poster', /^post\b/i],
]

export interface Usage {
  input: number
  write5m: number
  write1h: number
  read: number
  output: number
}

export interface AgentCost {
  id: string
  description: string
  role: Role
  mr: string | undefined
  parent?: string | undefined
  model: string
  turns: number
  startedAt: string
  usage: Usage
  dollars: number
}

export interface DiffSize {
  code: number
  tests: number
  docs: number
}

export interface MrCost {
  mr: string
  runner: string | undefined
  agents: AgentCost[]
  dollars: number
  byRole: Partial<Record<Role, number>>
  rerun: boolean | undefined
  diff: DiffSize | undefined
  threads: number | undefined
}

export interface CostRecord {
  date: string
  project: string
  session: string
  mr: string
  runner: string
  rerun: boolean | null
  lines: DiffSize | null
  threads: number | null
  dollars: number
  byRole: Partial<Record<Role, number>>
  cacheHit: number
}

const emptyUsage = (): Usage => ({ input: 0, write5m: 0, write1h: 0, read: 0, output: 0 })

const addUsage = (into: Usage, from: Usage): void => {
  into.input += from.input
  into.write5m += from.write5m
  into.write1h += from.write1h
  into.read += from.read
  into.output += from.output
}

export const priceOf = (model: string, prices: Readonly<Record<string, Price>>): Price | undefined =>
  Object.entries(prices).find(([family]) => model.includes(family))?.[1]

export const dollarsOf = (usage: Usage, price: Price | undefined): number => {
  if (price === undefined) return 0
  const input = usage.input + usage.write5m * CACHE_MULTIPLIERS.write5m + usage.write1h * CACHE_MULTIPLIERS.write1h + usage.read * CACHE_MULTIPLIERS.read
  return (input * price.input + usage.output * price.output) / 1e6
}

export const cacheHit = (usage: Usage): number => {
  const total = usage.input + usage.write5m + usage.write1h + usage.read
  return total === 0 ? 0 : usage.read / total
}

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

const toUsage = (raw: RawUsage): Usage => {
  const created = raw.cache_creation_input_tokens ?? 0
  const write5m = raw.cache_creation?.ephemeral_5m_input_tokens
  const write1h = raw.cache_creation?.ephemeral_1h_input_tokens
  const split = write5m !== undefined || write1h !== undefined
  return {
    input: raw.input_tokens ?? 0,
    write5m: split ? (write5m ?? 0) : created,
    write1h: split ? (write1h ?? 0) : 0,
    read: raw.cache_read_input_tokens ?? 0,
    output: raw.output_tokens ?? 0,
  }
}

interface TranscriptEntry {
  type?: string
  timestamp?: string
  uuid?: string
  origin?: { kind?: string }
  message?: { id?: string; model?: string; usage?: RawUsage; content?: unknown }
}

const parseEntry = (line: string): TranscriptEntry | undefined => {
  if (line.trim() === '') return undefined
  try {
    return JSON.parse(line) as TranscriptEntry
  } catch {
    return undefined
  }
}

export const messageIds = (text: string): Set<string> => {
  const ids = new Set<string>()
  for (const line of text.split('\n')) {
    const id = parseEntry(line)?.message?.id
    if (id !== undefined) ids.add(id)
  }
  return ids
}

/** `inherited`: message ids of the parent transcript, which a fork copies with their usage; they are not counted again. */
export const readTranscript = (text: string, inherited: ReadonlySet<string> = new Set()): { model: string; turns: number; startedAt: string; usage: Usage } => {
  const usageByMessageId = new Map<string, Usage>()
  let model = ''
  let firstTimestamp = ''
  let startedAt = ''
  for (const line of text.split('\n')) {
    const entry = parseEntry(line)
    if (entry === undefined) continue
    if (firstTimestamp === '' && typeof entry.timestamp === 'string') firstTimestamp = entry.timestamp
    const message = entry.message
    if (message?.usage === undefined || (message.id !== undefined && inherited.has(message.id))) continue
    if (startedAt === '' && typeof entry.timestamp === 'string') startedAt = entry.timestamp
    if (typeof message.model === 'string' && !message.model.startsWith('<')) model = message.model
    usageByMessageId.set(message.id ?? entry.uuid ?? String(usageByMessageId.size), toUsage(message.usage))
  }
  const usage = emptyUsage()
  for (const each of usageByMessageId.values()) addUsage(usage, each)
  return { model, turns: usageByMessageId.size, startedAt: inherited.size === 0 || startedAt === '' ? firstTimestamp : startedAt, usage }
}

export const roleOf = (description: string): Role => ROLE_PATTERNS.find(([, pattern]) => pattern.test(description))?.[0] ?? 'other'

export const mrOf = (description: string): string | undefined => /(?:!|\bMR\s*#?)(\d+)/i.exec(description)?.[1]

const mrOfArgs = (args: string): string | undefined => mrOf(args) ?? /\/(?:merge_requests|pull)\/(\d+)/.exec(args)?.[1]

const REVIEW_SKILL = /^(?:[\w-]+:)?(jig-review(?:-cycle)?)$/
const REVIEW_COMMAND = /<command-name>\/(?:[\w-]+:)?(jig-review(?:-cycle)?)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/

interface Invocation {
  skill: string
  args: string
}

const invocationOf = (entry: TranscriptEntry): Invocation | undefined => {
  const content = entry.message?.content
  if (typeof content === 'string') {
    const command = REVIEW_COMMAND.exec(content)
    return command?.[1] === undefined ? undefined : { skill: command[1], args: command[2] ?? '' }
  }
  if (!Array.isArray(content)) return undefined
  for (const block of content as { type?: string; name?: string; input?: { skill?: unknown; args?: unknown } }[]) {
    const skill = block.type === 'tool_use' && block.name === 'Skill' && typeof block.input?.skill === 'string' ? REVIEW_SKILL.exec(block.input.skill)?.[1] : undefined
    if (skill !== undefined) return { skill, args: typeof block.input?.args === 'string' ? block.input.args : '' }
  }
  return undefined
}

const isHumanPrompt = (entry: TranscriptEntry): boolean => entry.type === 'user' && entry.origin?.kind === 'human'

interface SessionRun extends Invocation {
  startedAt: string
  endedAt: string
  model: string
  usage: Map<string, Usage>
}

const mostSpawnedMr = (agents: readonly AgentCost[], run: SessionRun): string | undefined => {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    if (agent.mr !== undefined && agent.startedAt >= run.startedAt && agent.startedAt <= run.endedAt) counts.set(agent.mr, (counts.get(agent.mr) ?? 0) + 1)
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0]
}

/**
 * The turns of the session itself from each jig-review or jig-review-cycle invocation to the next human prompt, as agents:
 * a direct jig-review is the runner of its merge request (from the arguments, else the one its subagents name); the
 * review cycle's orchestrator is role `other`.
 */
export const readSessionRuns = (text: string, session: string, prices: Readonly<Record<string, Price>>, subagents: readonly AgentCost[]): AgentCost[] => {
  const runs: SessionRun[] = []
  let current: SessionRun | undefined
  for (const line of text.split('\n')) {
    const entry = parseEntry(line)
    if (entry === undefined) continue
    const invocation = invocationOf(entry)
    if (invocation !== undefined) {
      current = { ...invocation, startedAt: entry.timestamp ?? '', endedAt: entry.timestamp ?? '', model: '', usage: new Map() }
      runs.push(current)
    } else if (isHumanPrompt(entry)) {
      current = undefined
    }
    const message = entry.message
    if (current === undefined || message?.usage === undefined) continue
    if (typeof message.model === 'string' && !message.model.startsWith('<')) current.model = message.model
    current.usage.set(message.id ?? entry.uuid ?? String(current.usage.size), toUsage(message.usage))
    if (entry.timestamp !== undefined) current.endedAt = entry.timestamp
  }
  return runs.filter((run) => run.model !== '').map((run, index) => {
    const usage = emptyUsage()
    for (const each of run.usage.values()) addUsage(usage, each)
    const isRunner = run.skill === 'jig-review'
    return {
      id: `${session}#${index + 1}`,
      description: `${run.skill} in the session`,
      role: isRunner ? 'runner' : 'other',
      mr: isRunner ? (mrOfArgs(run.args) ?? mostSpawnedMr(subagents, run)) : undefined,
      model: run.model,
      turns: run.usage.size,
      startedAt: run.startedAt,
      usage,
      dollars: dollarsOf(usage, priceOf(run.model, prices)),
    }
  })
}

export const claudeProjectsDir = (env: NodeJS.ProcessEnv = process.env): string => join(env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'), 'projects')

export const projectSlug = (dir: string): string => dir.replace(/[^a-zA-Z0-9]/g, '-')

const TRANSCRIPTS_ONLY = 'jig review cost reads Claude Code transcripts only'

/** `given` is a session id or a session directory; without it, the most recently changed session of the project that has subagents. */
export const resolveSessionDir = (given: string | undefined, projectDir: string, projectsDir: string): string => {
  if (given !== undefined && existsSync(join(given, 'subagents'))) return given
  if (given !== undefined) {
    const found = existsSync(projectsDir)
      ? readdirSync(projectsDir)
          .map((slug) => join(projectsDir, slug, given))
          .find((dir) => existsSync(dir))
      : undefined
    if (found === undefined) throw new Error(`session ${given} not found under ${toSlash(projectsDir)}; ${TRANSCRIPTS_ONLY}`)
    return found
  }
  const slugDir = join(projectsDir, projectSlug(projectDir))
  if (!existsSync(slugDir)) throw new Error(`no sessions for ${toSlash(projectDir)} under ${toSlash(projectsDir)}; ${TRANSCRIPTS_ONLY}`)
  const sessions = readdirSync(slugDir)
    .map((name) => join(slugDir, name))
    .filter((dir) => existsSync(join(dir, 'subagents')))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  if (sessions[0] === undefined) throw new Error(`no session with subagents under ${toSlash(slugDir)}; ${TRANSCRIPTS_ONLY}`)
  return sessions[0]
}

/** A subagent's parent is `parentAgentId` from its meta; without one, the session itself, whose history a fork of the session copies. */
export const readAgents = (sessionDir: string, prices: Readonly<Record<string, Price>>): AgentCost[] => {
  const subagents = join(sessionDir, 'subagents')
  const sessionTranscript = `${sessionDir}.jsonl`
  const sessionIds = existsSync(sessionTranscript) ? messageIds(readFileSync(sessionTranscript, 'utf8')) : new Set<string>()
  const read = readdirSync(subagents)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const metaPath = join(subagents, name.replace(/\.jsonl$/, '.meta.json'))
      const meta = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as { description?: string; parentAgentId?: string }) : {}
      return { id: name.replace(/^agent-/, '').replace(/\.jsonl$/, ''), meta, text: readFileSync(join(subagents, name), 'utf8') }
    })
  const idsByAgent = new Map(read.map((agent) => [agent.id, messageIds(agent.text)]))
  return read.map(({ id, meta, text }) => {
    const description = meta.description ?? ''
    const transcript = readTranscript(text, (meta.parentAgentId === undefined ? undefined : idsByAgent.get(meta.parentAgentId)) ?? sessionIds)
    return {
      id,
      description,
      role: roleOf(description),
      mr: mrOf(description),
      parent: meta.parentAgentId,
      ...transcript,
      dollars: dollarsOf(transcript.usage, priceOf(transcript.model, prices)),
    }
  })
}

const runnerAncestor = (agent: AgentCost, byId: ReadonlyMap<string, AgentCost>): AgentCost | undefined => {
  const seen = new Set([agent.id])
  for (let parent = byId.get(agent.parent ?? ''); parent !== undefined && !seen.has(parent.id); parent = byId.get(parent.parent ?? '')) {
    if (parent.role === 'runner') return parent
    seen.add(parent.id)
  }
  return undefined
}

/** An agent spawned under a runner belongs to that runner; any other agent to the latest runner of the merge request its description names. */
export const groupByLatestRunner = (agents: readonly AgentCost[]): MrCost[] => {
  const sorted = [...agents].sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const groups = new Map<string, MrCost>()
  const latestRunner = new Map<string, string>()
  for (const agent of sorted) {
    const owner = runnerAncestor(agent, byId)
    const mr = owner?.mr ?? agent.mr
    if (mr === undefined) continue
    if (owner === undefined && agent.role === 'runner') latestRunner.set(mr, agent.id)
    const runner = owner?.id ?? latestRunner.get(mr)
    const key = `${mr}:${runner ?? ''}`
    const group = groups.get(key) ?? { mr, runner, agents: [], dollars: 0, byRole: {}, rerun: undefined, diff: undefined, threads: undefined }
    group.agents.push(agent)
    group.dollars += agent.dollars
    group.byRole[agent.role] = (group.byRole[agent.role] ?? 0) + agent.dollars
    groups.set(key, group)
  }
  return [...groups.values()]
}

interface ReviewState {
  target?: string
  base_sha?: string
  last_reviewed_sha?: string
  runs?: number
  findings?: { discussion_id?: string }[]
}

const readStates = (projectRoot: string): ReviewState[] => {
  const dir = join(projectRoot, '.jig', 'runs', 'review')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^[0-9a-f]+\.json$/.test(name))
    .flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(join(dir, name), 'utf8')) as ReviewState]
      } catch {
        return []
      }
    })
}

export const diffSize = (projectRoot: string, base: string, head: string): DiffSize | undefined => {
  const result = git(['diff', '--numstat', '-M', '-z', `${base}...${head}`], projectRoot)
  if (!result.ok) return undefined
  const size: DiffSize = { code: 0, tests: 0, docs: 0 }
  for (const stat of parseNumstat(result.stdout)) {
    const kind = exclusionOf(stat.path)
    const lines = stat.added + stat.deleted
    if (kind === 'lockfile') continue
    if (kind === 'markdown') size.docs += lines
    else if (kind === undefined) size.code += lines
    else size.tests += lines
  }
  return size
}

export const attachStates = (groups: MrCost[], projectRoot: string): void => {
  const states = readStates(projectRoot)
  for (const group of groups) {
    const state = states.find((candidate) => candidate.target === group.mr)
    if (state === undefined) continue
    group.rerun = (state.runs ?? 1) > 1
    group.threads = (state.findings ?? []).filter((finding) => finding.discussion_id !== undefined).length
    if (state.base_sha !== undefined && state.last_reviewed_sha !== undefined) group.diff = diffSize(projectRoot, state.base_sha, state.last_reviewed_sha)
  }
}

const money = (value: number): string => `$${value.toFixed(2)}`
const totalLines = (diff: DiffSize): number => diff.code + diff.tests + diff.docs

export const perThousandLines = (dollars: number, diff: DiffSize | undefined): number | undefined => {
  const lines = diff === undefined ? 0 : totalLines(diff)
  return lines === 0 ? undefined : (dollars * 1000) / lines
}

const roleCell = (byRole: Partial<Record<Role, number>>): string =>
  ROLES.filter((role) => (byRole[role] ?? 0) > 0)
    .map((role) => `${role} ${money(byRole[role] ?? 0)}`)
    .join(' · ')

export const formatSession = (session: string, agents: readonly AgentCost[], groups: readonly MrCost[]): string => {
  const total = agents.reduce((sum, agent) => sum + agent.dollars, 0)
  const usage = emptyUsage()
  agents.forEach((agent) => addUsage(usage, agent.usage))
  const byRole: Partial<Record<Role, number>> = {}
  for (const agent of agents) byRole[agent.role] = (byRole[agent.role] ?? 0) + agent.dollars
  const lines = [
    `session: ${session} · agents: ${agents.length} · total ${money(total)} (estimate) · cache hit ${(cacheHit(usage) * 100).toFixed(0)}%`,
    `by role: ${roleCell(byRole)}`,
    '',
  ]
  for (const group of groups) {
    const per1k = perThousandLines(group.dollars, group.diff)
    const diff = group.diff === undefined ? '?' : `${group.diff.code}/${group.diff.tests}/${group.diff.docs}`
    const perThread = group.threads === undefined || group.threads === 0 || group.rerun === true ? '-' : money(group.dollars / group.threads)
    lines.push(`!${group.mr}${group.rerun === true ? ' (re-review)' : ''}: ${money(group.dollars)} · ${roleCell(group.byRole)}`)
    lines.push(`  diff code/tests/docs ${diff} · $/1k lines ${per1k === undefined ? '-' : money(per1k)} · threads ${group.threads ?? '?'} · $/thread ${perThread}`)
  }
  const unassigned = agents.filter((agent) => agent.mr === undefined)
  if (unassigned.length > 0) lines.push(`no merge request in the description: ${unassigned.map((agent) => `${agent.description || agent.id} ${money(agent.dollars)}`).join(', ')}`)
  lines.push('', 'prices are estimates: per 1M tokens from ~/.jig/config.jsonc `prices`, else built-in list prices; cache write 5m ×1.25, 1h ×2, cache read ×0.1')
  return lines.join('\n')
}

export const costLogPath = (env: NodeJS.ProcessEnv = process.env): string => env['JIG_COST_LOG'] ?? join(homedir(), '.jig', 'review-cost.jsonl')

export const readLog = (path: string): CostRecord[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as CostRecord)
    : []

export const toRecords = (session: string, project: string, groups: readonly MrCost[]): CostRecord[] =>
  groups
    .filter((group) => group.runner !== undefined)
    .map((group) => {
      const usage = emptyUsage()
      group.agents.forEach((agent) => addUsage(usage, agent.usage))
      return {
        date: group.agents[0]?.startedAt.slice(0, 10) ?? '',
        project,
        session,
        mr: group.mr,
        runner: group.runner ?? '',
        rerun: group.rerun ?? null,
        lines: group.diff ?? null,
        threads: group.threads ?? null,
        dollars: Number(group.dollars.toFixed(4)),
        byRole: Object.fromEntries(Object.entries(group.byRole).map(([role, value]) => [role, Number(value.toFixed(4))])),
        cacheHit: Number(cacheHit(usage).toFixed(3)),
      }
    })

/** Appends only runs whose runner id the log does not hold yet; returns how many it appended. */
export const recordRuns = (path: string, records: readonly CostRecord[]): number => {
  const known = new Set(readLog(path).map((record) => record.runner))
  const fresh = records.filter((record) => !known.has(record.runner))
  if (fresh.length === 0) return 0
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, fresh.map((record) => `${JSON.stringify(record)}\n`).join(''))
  return fresh.length
}

export const isoWeek = (date: string): string => {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 3 - ((day.getUTCDay() + 6) % 7))
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((day.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export const formatReport = (records: readonly CostRecord[], by: 'project' | 'week'): string => {
  const rows = new Map<string, { runs: number; reruns: number; dollars: number; lines: number; threads: number; firstDollars: number }>()
  for (const record of records) {
    const key = by === 'project' ? record.project : `${record.project} ${isoWeek(record.date)}`
    const row = rows.get(key) ?? { runs: 0, reruns: 0, dollars: 0, lines: 0, threads: 0, firstDollars: 0 }
    row.runs++
    if (record.rerun === true) row.reruns++
    row.dollars += record.dollars
    row.lines += record.lines === null ? 0 : totalLines(record.lines)
    if (record.rerun !== true) {
      row.threads += record.threads ?? 0
      row.firstDollars += record.dollars
    }
    rows.set(key, row)
  }
  if (rows.size === 0) return `no runs recorded in ${toSlash(costLogPath())}: run jig review cost --record after a review`
  return [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, row]) =>
        `${key}: runs ${row.runs} (re-reviews ${row.reruns}) · ${money(row.dollars)} · $/1k lines ${row.lines === 0 ? '-' : money((row.dollars * 1000) / row.lines)} · $/thread (first runs) ${row.threads === 0 ? '-' : money(row.firstDollars / row.threads)}`,
    )
    .join('\n')
}

const projectName = (root: string): string => {
  const remote = git(['remote', 'get-url', 'origin'], root)
  const url = remote.ok ? remote.stdout.trim() : ''
  return url === '' ? basename(root) : url.replace(/\.git$/, '').replace(/^.*[/:]([^/:]+\/[^/:]+)$/, '$1')
}

const USAGE = 'usage: jig review cost [<session id or dir>] [--project <dir>] [--record] [--json] | jig review cost --report [--by project|week]'

export const runReviewCost: Command = (args) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      project: { type: 'string' },
      record: { type: 'boolean' },
      report: { type: 'boolean' },
      by: { type: 'string' },
      json: { type: 'boolean' },
    },
  })
  if (values.report === true) {
    const by = values.by ?? 'project'
    if (by !== 'project' && by !== 'week') throw new Error(`--by expects project or week, got ${by}`)
    process.stdout.write(`${formatReport(readLog(costLogPath()), by)}\n`)
    return 0
  }
  if (positionals.length > 1) throw new Error(USAGE)
  const cwd = values.project ?? process.cwd()
  const projectRoot = listWorktrees(cwd)[0]?.path ?? cwd
  const loaded = loadUserConfig()
  if (loaded.error !== undefined) throw new Error(`${loaded.label}: ${loaded.error}`)
  const prices = { ...DEFAULT_PRICES, ...loaded.config.prices }
  const sessionDir = resolveSessionDir(positionals[0], projectRoot, claudeProjectsDir())
  const session = basename(sessionDir)
  const subagents = readAgents(sessionDir, prices)
  const transcript = `${sessionDir}.jsonl`
  const agents = [...(existsSync(transcript) ? readSessionRuns(readFileSync(transcript, 'utf8'), session, prices, subagents) : []), ...subagents]
  const groups = groupByLatestRunner(agents)
  attachStates(groups, projectRoot)
  if (values.json === true) {
    process.stdout.write(`${JSON.stringify({ session, agents, groups: groups.map(({ agents: members, ...group }) => ({ ...group, agents: members.map((agent) => agent.id) })) }, null, 2)}\n`)
  } else {
    process.stdout.write(`${formatSession(session, agents, groups)}\n`)
  }
  if (values.record === true) {
    const path = costLogPath()
    const added = recordRuns(path, toRecords(session, projectName(projectRoot), groups))
    process.stdout.write(`recorded: ${added} new run${added === 1 ? '' : 's'} in ${toSlash(path)}\n`)
  }
  return 0
}
