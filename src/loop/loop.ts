import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJournal, type JournalKind, type JournalRecord } from '../core/journal'
import { ensureJigDir, resolveProjectRoot } from '../core/paths'

type Command = (args: string[]) => number | Promise<number>

interface Candidate {
  kind: JournalKind
  rule?: string
  file?: string
  count: number
  examples: JournalRecord[]
}

const DEFAULT_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const MIN_TURNS = 2
const MAX_EXAMPLES = 3

const SINGLE_RECORD_KINDS: ReadonlySet<JournalKind> = new Set(['gate-giveup', 'gate-unresolved', 'hook-failure', 'tool-failure'])
const DISTINCT_TURN_KINDS: ReadonlySet<JournalKind> = new Set(['deny', 'finding', 'gate-block'])

interface Group {
  kind: JournalKind
  rule?: string
  file?: string
  records: JournalRecord[]
  turns: Set<string>
}

const byTime = (left: JournalRecord, right: JournalRecord): number => Date.parse(left.ts) - Date.parse(right.ts)

const turnKey = (record: JournalRecord, index: number): string =>
  record.turn === undefined ? `record:${index}` : JSON.stringify([record.session, record.agent, record.turn])

const isCandidate = (group: Group): boolean => {
  if (SINGLE_RECORD_KINDS.has(group.kind)) return true
  return DISTINCT_TURN_KINDS.has(group.kind) && group.turns.size >= MIN_TURNS
}

const compareCandidates = (left: Candidate, right: Candidate): number =>
  right.count - left.count ||
  left.kind.localeCompare(right.kind) ||
  (left.rule ?? '').localeCompare(right.rule ?? '') ||
  (left.file ?? '').localeCompare(right.file ?? '')

const findCandidates = (records: readonly JournalRecord[]): Candidate[] => {
  const groups = new Map<string, Group>()
  for (const [index, record] of [...records].sort(byTime).entries()) {
    const key = JSON.stringify([record.kind, record.rule ?? null, record.file ?? null])
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        kind: record.kind,
        records: [],
        turns: new Set(),
        ...(record.rule !== undefined && { rule: record.rule }),
        ...(record.file !== undefined && { file: record.file }),
      }
      groups.set(key, group)
    }
    group.records.push(record)
    group.turns.add(turnKey(record, index))
  }
  return [...groups.values()]
    .filter(isCandidate)
    .map((group) => ({
      kind: group.kind,
      ...(group.rule !== undefined && { rule: group.rule }),
      ...(group.file !== undefined && { file: group.file }),
      count: group.records.length,
      examples: group.records.slice(0, MAX_EXAMPLES),
    }))
    .sort(compareCandidates)
}

const cell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

const formatLocation = (record: JournalRecord): string | undefined => {
  if (record.file === undefined) return undefined
  return record.line === undefined ? record.file : `${record.file}:${record.line}`
}

const formatExample = (record: JournalRecord): string => {
  const location = formatLocation(record)
  const parts = [location === undefined ? undefined : `\`${location}\``, record.ts, record.message]
  return cell(parts.filter((part) => part !== undefined).join(' '))
}

const formatCandidateTable = (candidates: readonly Candidate[]): string[] => {
  if (candidates.length === 0) return ['No candidates.']
  const rows = candidates.map(
    (candidate) =>
      `| ${candidate.kind} | ${cell(candidate.rule ?? '')} | ${candidate.count} | ${candidate.examples.map(formatExample).join('<br>')} |`,
  )
  return ['| Signal | Rule | Count | Examples |', '| --- | --- | --- | --- |', ...rows]
}

const formatCounts = (records: readonly JournalRecord[]): string[] => {
  const counts = new Map<JournalKind, number>()
  for (const record of records) {
    counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1)
  }
  if (counts.size === 0) return ['No records.']
  const rows = [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([kind, count]) => `| ${kind} | ${count} |`)
  return ['| Kind | Count |', '| --- | --- |', ...rows]
}

const formatCandidates = (records: readonly JournalRecord[], from: Date, to: Date, days: number): string =>
  [
    '# jig loop candidates',
    '',
    `Window: ${from.toISOString()} .. ${to.toISOString()} (${days} days)`,
    '',
    '## Candidates',
    '',
    ...formatCandidateTable(findCandidates(records)),
    '',
    '## Counts',
    '',
    ...formatCounts(records),
    '',
  ].join('\n')

const parseDays = (args: readonly string[]): number => {
  if (args.length === 0) return DEFAULT_DAYS
  const [flag, value, ...rest] = args
  const days = Number(value)
  const isValid = flag === '--days' && rest.length === 0 && Number.isInteger(days) && days > 0
  if (!isValid) {
    throw new Error('usage: jig loop [--days <positive integer>]')
  }
  return days
}

export const runLoop: Command = (args) => {
  const days = parseDays(args)
  const projectRoot = resolveProjectRoot(process.cwd())
  const to = new Date()
  const from = new Date(to.getTime() - days * DAY_MS)
  const records = readJournal(projectRoot, from.getTime())
  const dir = join(ensureJigDir(projectRoot).runs, '_loop', to.toISOString().slice(0, 10))
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'candidates.md')
  writeFileSync(path, formatCandidates(records, from, to, days))
  process.stdout.write(`${path}\n`)
  return 0
}
