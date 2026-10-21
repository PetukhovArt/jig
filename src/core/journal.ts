import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { jigPaths } from './paths'

export type JournalKind =
  | 'deny'
  | 'finding'
  | 'gate-block'
  | 'gate-pass'
  | 'gate-skipped'
  | 'gate-unresolved'
  | 'gate-giveup'
  | 'foreign-change'
  | 'subagent-start'
  | 'tool-failure'
  | 'hook-failure'
  | 'skip-verify'
  | 'proof'
  | 'bug-bash'

export type JournalTool = string

export interface JournalRecord {
  v: 1
  ts: string
  session: string
  agent: string
  turn?: number
  kind: JournalKind
  rule?: string
  tool?: JournalTool
  file?: string
  line?: number
  message?: string
  durationMs?: number
  head?: string
  tree?: string
}

export type JournalEntry = Omit<JournalRecord, 'v' | 'ts'> & { ts?: string }

export const JOURNAL_MAX_AGE_DAYS = 30
export const JOURNAL_MAX_BYTES = 50 * 1024 * 1024
export const JOURNAL_MESSAGE_MAX = 300

const DAY_MS = 24 * 60 * 60 * 1000
const JOURNAL_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

interface JournalFile {
  name: string
  path: string
  day: string
  size: number
}

const truncate = (text: string): string =>
  text.length <= JOURNAL_MESSAGE_MAX ? text : `${text.slice(0, JOURNAL_MESSAGE_MAX - 1)}…`

export const appendJournal = (projectRoot: string, entry: JournalEntry): JournalRecord => {
  const record: JournalRecord = { v: 1, ...entry, ts: entry.ts ?? new Date().toISOString() }
  if (record.message !== undefined) {
    record.message = truncate(record.message)
  }
  const dir = jigPaths(projectRoot).journal
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, `${record.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`)
  return record
}

export const listJournalFiles = (projectRoot: string): JournalFile[] => {
  const dir = jigPaths(projectRoot).journal
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const files: JournalFile[] = []
  for (const name of names.sort()) {
    const day = JOURNAL_FILE.exec(name)?.[1]
    if (day === undefined) continue
    const path = join(dir, name)
    files.push({ name, path, day, size: statSync(path).size })
  }
  return files
}

export const journalSize = (projectRoot: string): number =>
  listJournalFiles(projectRoot).reduce((total, file) => total + file.size, 0)

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const rotateJournal = (projectRoot: string, now: number = Date.now()): string[] => {
  const oldestKept = dayOf(now - JOURNAL_MAX_AGE_DAYS * DAY_MS)
  const removed: string[] = []
  const kept: JournalFile[] = []
  for (const file of listJournalFiles(projectRoot)) {
    if (file.day >= oldestKept) {
      kept.push(file)
      continue
    }
    rmSync(file.path, { force: true })
    removed.push(file.name)
  }
  let total = kept.reduce((sum, file) => sum + file.size, 0)
  for (const file of kept) {
    if (total <= JOURNAL_MAX_BYTES) break
    rmSync(file.path, { force: true })
    removed.push(file.name)
    total -= file.size
  }
  return removed
}

const parseRecord = (line: string): JournalRecord | undefined => {
  try {
    const value = JSON.parse(line) as Partial<JournalRecord>
    const isRecord = value.v === 1 && typeof value.ts === 'string' && typeof value.kind === 'string'
    return isRecord ? (value as JournalRecord) : undefined
  } catch {
    return undefined
  }
}

export const readJournal = (projectRoot: string, sinceMs = 0): JournalRecord[] => {
  const sinceDay = dayOf(sinceMs)
  const records: JournalRecord[] = []
  for (const file of listJournalFiles(projectRoot)) {
    if (file.day < sinceDay) continue
    for (const line of readFileSync(file.path, 'utf8').split('\n')) {
      const record = line.trim() === '' ? undefined : parseRecord(line)
      if (record !== undefined && Date.parse(record.ts) >= sinceMs) {
        records.push(record)
      }
    }
  }
  return records
}
