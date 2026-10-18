import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitCurrentBranch, gitShortSha } from '../core/git'
import { ensureJigDir, jigPaths, resolveProjectRoot, toSlash } from '../core/paths'
import { writeFileAtomic } from '../core/state'
import template from './template.html'

type Command = (args: string[]) => number | Promise<number>

export type StepStatus = 'todo' | 'active' | 'done' | 'blocked'

export interface RunStep {
  n: number
  title: string
  status: StepStatus
  waitsFor?: string
  at: string
}

export interface RunDecision {
  n: number
  text: string
  why?: string
  evidence?: string
  result?: 'kept' | 'reverted'
  at: string
}

export interface RunResult {
  title: string
  href?: string
  at: string
}

export interface RunAsk {
  n: number
  question: string
  default: string
  answer?: string
  askedAt: string
  answeredAt?: string
}

export const RUN_LANGS = ['en', 'ru'] as const

export type RunLang = (typeof RUN_LANGS)[number]

export interface Run {
  v: 1
  title: string
  lang: RunLang
  branch: string
  createdAt: string
  updatedAt: string
  steps: RunStep[]
  decisions: RunDecision[]
  results: RunResult[]
  asks: RunAsk[]
}

export interface ActiveRun {
  run: Run
  page: string
}

interface RunLocation {
  branch: string
  data: string
  page: string
}

type Mutation = (run: Run, args: string[], at: string) => string

const ACTIVE_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1000

const EXIT_NOT_MET = 1
const EXIT_USAGE = 2
const RUN_BLOCK = /(<script type="application\/json" id="run">)([\s\S]*?)(<\/script>)/
const DECISION_FLAGS = new Set(['--why', '--evidence', '--result'])
const DECISION_RESULTS = new Set(['kept', 'reverted'])
const PLAIN_STATUSES = new Set<StepStatus>(['active', 'done', 'todo'])
const CURRENT_STEP_ORDER: StepStatus[] = ['active', 'blocked', 'todo']

class DashFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

const usage = (message: string): DashFailure => new DashFailure(EXIT_USAGE, message)

const noActiveRun = (location: { branch: string }): DashFailure =>
  new DashFailure(EXIT_NOT_MET, `no active run for branch ${location.branch}, start one with: dash init --lang <en|ru> "<title>" "<step>"...`)

const branchDirName = (projectRoot: string): string => {
  const branch = gitCurrentBranch(projectRoot)
  if (branch !== undefined) return branch.replace(/[^A-Za-z0-9._-]/g, '_')
  return `detached-${gitShortSha(projectRoot) ?? 'none'}`
}

const runLocation = (projectRoot: string): RunLocation => {
  const branch = branchDirName(projectRoot)
  const dir = join(jigPaths(projectRoot).runs, branch)
  return { branch, data: join(dir, 'run.json'), page: join(dir, 'index.html') }
}

const isRun = (value: unknown): value is Run => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Run>
  return candidate.v === 1 && typeof candidate.updatedAt === 'string' && Array.isArray(candidate.steps)
}

const readRun = (path: string): Run | undefined => {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  const value: unknown = JSON.parse(text)
  return isRun(value) ? value : undefined
}

const isActive = (run: Run, now: Date): boolean =>
  now.getTime() - Date.parse(run.updatedAt) < ACTIVE_RUN_MAX_AGE_MS

export const readActiveRun = (projectRoot: string, now: Date = new Date()): ActiveRun | undefined => {
  const location = runLocation(projectRoot)
  const run = readRun(location.data)
  if (run === undefined || !isActive(run, now)) return undefined
  return { run, page: toSlash(location.page) }
}

const currentStep = (run: Run): RunStep | undefined => {
  for (const status of CURRENT_STEP_ORDER) {
    const step = run.steps.find((candidate) => candidate.status === status)
    if (step) return step
  }
  return run.steps.at(-1)
}

export const activeRunContext = (projectRoot: string, now: Date = new Date()): string | undefined => {
  const active = readActiveRun(projectRoot, now)
  if (active === undefined) return undefined
  const step = currentStep(active.run)
  const stepPart = step ? `step ${step.n} "${step.title}"` : 'no steps'
  return `jig: flow run "${active.run.title}", ${stepPart}, dashboard ${active.page}`
}

const renderPage = (run: Run): string => {
  const json = JSON.stringify(run, null, 2).replace(/</g, '\\u003c')
  return template.replace(RUN_BLOCK, (_match, open: string, _body: string, close: string) => `${open}\n${json}\n${close}`)
}

const saveRun = (location: RunLocation, run: Run): void => {
  mkdirSync(dirname(location.data), { recursive: true })
  writeFileAtomic(location.data, `${JSON.stringify(run, null, 2)}\n`)
  writeFileAtomic(location.page, renderPage(run))
}

const required = (value: string | undefined, what: string): string => {
  if (value === undefined || value === '') throw usage(`${what} is required`)
  return value
}

const parseNumber = (value: string | undefined, what: string): number => {
  const text = required(value, what)
  const n = Number(text)
  if (!Number.isInteger(n) || n < 1) throw new DashFailure(EXIT_NOT_MET, `${what} must be a positive integer, got ${text}`)
  return n
}

const stepAt = (run: Run, n: number): RunStep => {
  const step = run.steps.find((candidate) => candidate.n === n)
  if (step === undefined) throw new DashFailure(EXIT_NOT_MET, `no step ${n}, the run has ${run.steps.length}`)
  return step
}

const nextNumber = (items: { n: number }[]): number => items.reduce((max, item) => Math.max(max, item.n), 0) + 1

const setStep: Mutation = (run, [nText, status, waitsFor], at) => {
  const step = stepAt(run, parseNumber(nText, 'step number'))
  delete step.waitsFor
  step.at = at
  if (status === 'blocked') {
    step.status = 'blocked'
    step.waitsFor = required(waitsFor, 'what the blocked step waits for')
    return 'ok'
  }
  const isPlainStatus = status !== undefined && PLAIN_STATUSES.has(status as StepStatus)
  if (!isPlainStatus) throw usage(`step status must be active, done, todo or blocked, got ${status ?? 'nothing'}`)
  step.status = status as StepStatus
  return 'ok'
}

const addStep: Mutation = (run, [title], at) => {
  run.steps.push({ n: nextNumber(run.steps), title: required(title, 'step title'), status: 'todo', at })
  return 'ok'
}

const parseDecisionFlags = (args: string[]): Map<string, string> => {
  const flags = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? ''
    if (!DECISION_FLAGS.has(flag)) throw usage(`unknown decision option ${flag}`)
    flags.set(flag, required(args[index + 1], `value of ${flag}`))
  }
  return flags
}

export interface DecisionDetails {
  evidence?: string
  result?: 'kept' | 'reverted'
}

export const addRunDecision = (
  projectRoot: string,
  text: string,
  why?: string,
  details: DecisionDetails = {},
  now: Date = new Date(),
): boolean => {
  const location = runLocation(projectRoot)
  const run = readRun(location.data)
  if (run === undefined || !isActive(run, now)) return false
  const at = now.toISOString()
  run.decisions.push({
    n: nextNumber(run.decisions),
    text: required(text, 'decision text'),
    ...(why === undefined ? {} : { why }),
    ...(details.evidence === undefined ? {} : { evidence: details.evidence }),
    ...(details.result === undefined ? {} : { result: details.result }),
    at,
  })
  run.updatedAt = at
  saveRun(location, run)
  return true
}

const recordDecision = (projectRoot: string, location: RunLocation, [text, ...rest]: string[], now: Date): string => {
  const flags = parseDecisionFlags(rest)
  const evidence = flags.get('--evidence')
  const result = flags.get('--result')
  if (result !== undefined && !DECISION_RESULTS.has(result)) throw usage(`--result must be kept or reverted, got ${result}`)
  const details: DecisionDetails = {
    ...(evidence === undefined ? {} : { evidence }),
    ...(result === undefined ? {} : { result: result as 'kept' | 'reverted' }),
  }
  if (!addRunDecision(projectRoot, required(text, 'decision text'), flags.get('--why'), details, now)) throw noActiveRun(location)
  return 'ok'
}

const addResult: Mutation = (run, [title, href], at) => {
  run.results.push({ title: required(title, 'result title'), ...(href ? { href } : {}), at })
  return 'ok'
}

const addAsk: Mutation = (run, [question, fallback], at) => {
  const n = nextNumber(run.asks)
  run.asks.push({ n, question: required(question, 'question'), default: required(fallback, 'default answer'), askedAt: at })
  return String(n)
}

const answerAsk: Mutation = (run, [nText, answer], at) => {
  const n = parseNumber(nText, 'question number')
  const text = required(answer, 'answer')
  const ask = run.asks.find((candidate) => candidate.n === n && candidate.answer === undefined)
  if (ask === undefined) throw new DashFailure(EXIT_NOT_MET, `no open question ${n}`)
  ask.answer = text
  ask.answeredAt = at
  run.decisions.push({ n: nextNumber(run.decisions), text: `${ask.question} ${text}`, at })
  return 'ok'
}

const MUTATIONS = new Map<string, Mutation>([
  ['step', setStep],
  ['add', addStep],
  ['result', addResult],
  ['ask', addAsk],
  ['answer', answerAsk],
])

const sameShape = (run: Run, title: string, steps: string[]): boolean =>
  run.title === title &&
  run.steps.length === steps.length &&
  run.steps.every((step, index) => step.title === steps[index])

const isRunLang = (value: string | undefined): value is RunLang => RUN_LANGS.some((lang) => lang === value)

const parseLang = ([flag, value, ...rest]: string[]): { lang: RunLang; rest: string[] } => {
  if (flag !== '--lang') throw usage('init needs --lang <en|ru> first: the language the session is held in')
  if (!isRunLang(value)) throw usage(`--lang must be ${RUN_LANGS.join(' or ')}, got ${value ?? 'nothing'}`)
  return { lang: value, rest }
}

const initRun = (projectRoot: string, location: RunLocation, args: string[], now: Date): string => {
  const { lang, rest: [title, ...steps] } = parseLang(args)
  const runTitle = required(title, 'run title')
  if (steps.length === 0) throw usage('init needs at least one step')
  ensureJigDir(projectRoot)
  const at = now.toISOString()
  const existing = readRun(location.data)
  const isKept = existing !== undefined && sameShape(existing, runTitle, steps)
  const run: Run = isKept
    ? { ...existing, lang, updatedAt: at }
    : {
        v: 1,
        title: runTitle,
        lang,
        branch: location.branch,
        createdAt: at,
        updatedAt: at,
        steps: steps.map((stepTitle, index) => ({
          n: index + 1,
          title: stepTitle,
          status: index === 0 ? 'active' : 'todo',
          at,
        })),
        decisions: [],
        results: [],
        asks: [],
      }
  saveRun(location, run)
  return toSlash(location.page)
}

const dispatch = (args: string[], now: Date): string => {
  const [sub, ...rest] = args
  const projectRoot = resolveProjectRoot(process.cwd())
  const location = runLocation(projectRoot)
  if (sub === 'init') return initRun(projectRoot, location, rest, now)
  if (sub === 'decision') return recordDecision(projectRoot, location, rest, now)

  const mutation = sub === undefined ? undefined : MUTATIONS.get(sub)
  if (sub !== 'path' && mutation === undefined) {
    throw usage(`unknown dash subcommand ${sub ?? '(none)'}, expected init, step, add, decision, result, ask, answer or path`)
  }

  const run = readRun(location.data)
  if (run === undefined || !isActive(run, now)) throw noActiveRun(location)
  if (mutation === undefined) return toSlash(location.page)

  const at = now.toISOString()
  const output = mutation(run, rest, at)
  run.updatedAt = at
  saveRun(location, run)
  return output
}

export const runDash: Command = (args) => {
  try {
    process.stdout.write(`${dispatch(args, new Date())}\n`)
    return 0
  } catch (error) {
    if (!(error instanceof DashFailure)) throw error
    process.stderr.write(`jig: ${error.message}\n`)
    return error.code
  }
}
