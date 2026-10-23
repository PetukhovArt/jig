import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitCurrentBranch, gitShortSha } from '../core/git'
import { ensureJigDir, jigPaths, resolveProjectRoot, toSlash } from '../core/paths'
import { writeFileAtomic } from '../core/state'
import template from './template.html'

type Command = (args: string[]) => number | Promise<number>

export const COLUMNS = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'] as const

export type Column = (typeof COLUMNS)[number]

export type Row = Record<Column, string>

export type RowInput = Pick<Row, 'phase' | 'decision'> & Partial<Pick<Row, 'why' | 'evidence' | 'result'>>

export const START_PHASE = 'start'

export const PAGE_LANGS = ['en', 'ru'] as const

export type PageLang = (typeof PAGE_LANGS)[number]

export interface JournalLocation {
  branch: string
  journal: string
  page: string
}

export interface ActiveJournal {
  rows: Row[]
  journal: string
}

const ACTIVE_JOURNAL_MAX_AGE_MS = 12 * 60 * 60 * 1000

const EXIT_NOT_MET = 1
const EXIT_USAGE = 2
const HEADER = COLUMNS.join('\t')
const DATA_BLOCK = /(<script type="application\/json" id="status">)([\s\S]*?)(<\/script>)/
const LOG_FLAGS = new Map<string, 'why' | 'evidence' | 'result'>([
  ['--why', 'why'],
  ['--evidence', 'evidence'],
  ['--result', 'result'],
])
const LOG_USAGE = 'usage: task-status log <phase> <decision> [--why <text>] [--evidence <text>] [--result <text>]'

class TaskStatusFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

const usage = (message: string): TaskStatusFailure => new TaskStatusFailure(EXIT_USAGE, message)

const branchDirName = (projectRoot: string): string => {
  const branch = gitCurrentBranch(projectRoot)
  if (branch !== undefined) return branch.replace(/[^A-Za-z0-9._-]/g, '_')
  return `detached-${gitShortSha(projectRoot) ?? 'none'}`
}

export const journalLocation = (projectRoot: string): JournalLocation => {
  const branch = branchDirName(projectRoot)
  const dir = join(jigPaths(projectRoot).runs, branch)
  return { branch, journal: join(dir, 'task-status.tsv'), page: join(dir, 'task-status.html') }
}

/**
 * Keeps a cell on one line: each tab, line break or carriage return becomes one space.
 * Backslashes stay as they are, so a Windows path in evidence reads back unchanged.
 */
export const cleanCell = (value: string): string => value.replace(/\r\n|[\t\n\r]/g, ' ').trim()

export const formatRow = (row: Row): string => COLUMNS.map((column) => cleanCell(row[column])).join('\t')

const parseLine = (line: string): Row => {
  const [ts = '', phase = '', decision = '', why = '', evidence = '', ...result] = line.split('\t')
  return { ts, phase, decision, why, evidence, result: result.join(' ') }
}

export const parseJournal = (text: string): Row[] =>
  text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '' && line !== HEADER)
    .map(parseLine)

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export const readJournalRows = (path: string): Row[] | undefined => {
  const text = readText(path)
  return text === undefined ? undefined : parseJournal(text)
}

export const appendRow = (path: string, input: RowInput, now: Date): Row => {
  const row: Row = {
    ts: now.toISOString(),
    phase: cleanCell(input.phase),
    decision: cleanCell(input.decision),
    why: cleanCell(input.why ?? ''),
    evidence: cleanCell(input.evidence ?? ''),
    result: cleanCell(input.result ?? ''),
  }
  mkdirSync(dirname(path), { recursive: true })
  const isFresh = (readText(path) ?? '').trim() === ''
  appendFileSync(path, `${isFresh ? `${HEADER}\n` : ''}${formatRow(row)}\n`)
  return row
}

const isActive = (rows: readonly Row[], now: Date): boolean => {
  const last = rows.at(-1)
  if (last === undefined) return false
  return now.getTime() - Date.parse(last.ts) < ACTIVE_JOURNAL_MAX_AGE_MS
}

export const readActiveJournal = (projectRoot: string, now: Date = new Date()): ActiveJournal | undefined => {
  const location = journalLocation(projectRoot)
  const rows = readJournalRows(location.journal)
  if (rows === undefined || !isActive(rows, now)) return undefined
  return { rows, journal: toSlash(location.journal) }
}

export const logToActiveJournal = (projectRoot: string, input: RowInput, now: Date = new Date()): boolean => {
  const location = journalLocation(projectRoot)
  const rows = readJournalRows(location.journal)
  if (rows === undefined || !isActive(rows, now)) return false
  appendRow(location.journal, input, now)
  return true
}

const lastStart = (rows: readonly Row[]): Row | undefined => rows.findLast((row) => row.phase === START_PHASE)

export const activeRunContext = (projectRoot: string, now: Date = new Date()): string | undefined => {
  const active = readActiveJournal(projectRoot, now)
  const last = active?.rows.at(-1)
  if (active === undefined || last === undefined) return undefined
  const start = lastStart(active.rows)
  const title = start === undefined ? '' : ` "${start.decision}"`
  return `jig: task-status run${title}, last row ${last.phase}: "${last.decision}", journal ${active.journal}`
}

const parseLog = (args: string[]): RowInput => {
  const positional: string[] = []
  const options: Partial<Record<'why' | 'evidence' | 'result', string>> = {}
  for (let index = 0; index < args.length; index++) {
    const token = args[index] ?? ''
    const key = LOG_FLAGS.get(token)
    if (key !== undefined) {
      const value = args[index + 1]
      if (value === undefined) throw usage(`${token} needs a value. ${LOG_USAGE}`)
      options[key] = value
      index++
      continue
    }
    if (token.startsWith('--')) throw usage(`unknown option ${token}. ${LOG_USAGE}`)
    positional.push(token)
  }
  const [phase, decision, ...rest] = positional
  const isComplete = phase !== undefined && cleanCell(phase) !== '' && decision !== undefined && cleanCell(decision) !== ''
  if (!isComplete || rest.length > 0) throw usage(LOG_USAGE)
  return { phase, decision, ...options }
}

const isPageLang = (value: string | undefined): value is PageLang => PAGE_LANGS.some((lang) => lang === value)

const OPEN_USAGE = 'usage: task-status open [--lang en|ru] [--no-browser]'

interface OpenOptions {
  lang: PageLang
  isBrowser: boolean
}

const parseOpen = (args: string[]): OpenOptions => {
  const options: OpenOptions = { lang: 'en', isBrowser: true }
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (token === '--no-browser') {
      options.isBrowser = false
      continue
    }
    if (token !== '--lang') throw usage(OPEN_USAGE)
    const value = args[index + 1]
    if (!isPageLang(value)) throw usage(`--lang must be ${PAGE_LANGS.join(' or ')}, got ${value ?? 'nothing'}`)
    options.lang = value
    index++
  }
  return options
}

const browserCommand = (platform: NodeJS.Platform, path: string): string[] => {
  if (platform === 'win32') return ['explorer.exe', path]
  if (platform === 'darwin') return ['open', path]
  return ['xdg-open', path]
}

const showInBrowserBestEffort = (path: string): void => {
  if (process.env['CI'] !== undefined) return
  const [command = '', ...args] = browserCommand(process.platform, path)
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
  } catch {
    return
  }
}

export interface PageData {
  branch: string
  journal: string
  builtAt: string
  lang: PageLang
  rows: Row[]
}

export const renderPage = (data: PageData): string => {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c')
  return template.replace(DATA_BLOCK, (_match, open: string, _body: string, close: string) => `${open}\n${json}\n${close}`)
}

const noJournal = (location: JournalLocation): TaskStatusFailure =>
  new TaskStatusFailure(EXIT_NOT_MET, `no task-status journal for branch ${location.branch}, start one with: task-status log start "<task title>"`)

const openPage = (location: JournalLocation, args: string[], now: Date): string => {
  const { lang, isBrowser } = parseOpen(args)
  const rows = readJournalRows(location.journal)
  if (rows === undefined) throw noJournal(location)
  const journal = toSlash(location.journal)
  writeFileAtomic(location.page, renderPage({ branch: location.branch, journal, builtAt: now.toISOString(), lang, rows }))
  if (isBrowser) showInBrowserBestEffort(location.page)
  return toSlash(location.page)
}

const dispatch = (args: string[], now: Date): string => {
  const [sub, ...rest] = args
  const projectRoot = resolveProjectRoot(process.cwd())
  const location = journalLocation(projectRoot)
  if (sub === 'log') {
    const input = parseLog(rest)
    ensureJigDir(projectRoot)
    appendRow(location.journal, input, now)
    return toSlash(location.journal)
  }
  if (sub === 'open') return openPage(location, rest, now)
  if (sub === 'path') {
    if (readJournalRows(location.journal) === undefined) throw noJournal(location)
    return toSlash(location.journal)
  }
  throw usage(`unknown task-status subcommand ${sub ?? '(none)'}, expected log, open or path`)
}

export const runTaskStatus: Command = (args) => {
  try {
    process.stdout.write(`${dispatch(args, new Date())}\n`)
    return 0
  } catch (error) {
    if (!(error instanceof TaskStatusFailure)) throw error
    process.stderr.write(`jig: ${error.message}\n`)
    return error.code
  }
}
