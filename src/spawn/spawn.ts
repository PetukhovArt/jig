import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveBin, run, type RunResult } from '../core/proc'
import { detectAgent, loadUserConfig, resolveTiers, TIERS, type Tier } from '../tiers/tiers'

type Command = (args: string[]) => number | Promise<number>

const EFFORTS = ['low', 'medium', 'high'] as const
type Effort = (typeof EFFORTS)[number]

const DEFAULT_MAX_PARALLEL = 4
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const LOGIN_TIMEOUT_MS = 60 * 1000
const STDERR_TAIL = 600

interface Job {
  agent: string
  model: string
  effort: Effort
  cwd: string
  brief: string
  report: string
}

interface Launcher {
  login: readonly string[]
  loginHint: string
  isLoggedIn: (result: RunResult) => boolean
  argv: (job: Job) => string[]
  reportFromStdout: boolean
}

const LAUNCHERS: Readonly<Record<string, Launcher>> = {
  codex: {
    login: ['login', 'status'],
    loginHint: 'codex login',
    isLoggedIn: (result) => result.code === 0,
    argv: ({ model, effort, cwd, report }) => [
      'exec',
      '-m',
      model,
      '-c',
      `model_reasoning_effort=${effort}`,
      ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : []),
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '-C',
      cwd,
      '-o',
      report,
      '-',
    ],
    reportFromStdout: false,
  },
  claude: {
    login: ['auth', 'status'],
    loginHint: 'claude auth login',
    isLoggedIn: (result) => result.code === 0 && /"loggedIn"\s*:\s*true/.test(result.stdout),
    argv: ({ model, effort }) => [
      '-p',
      '--model',
      model,
      '--effort',
      effort,
      '--permission-mode',
      'dontAsk',
      '--no-session-persistence',
      '--disallowedTools',
      'Edit',
      'Write',
      'NotebookEdit',
    ],
    reportFromStdout: true,
  },
}

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T => {
  if (value !== undefined && (allowed as readonly string[]).includes(value)) return value as T
  throw new Error(`--${flag} expects one of: ${allowed.join(', ')}`)
}

const positiveInteger = (value: string | undefined, flag: string, fallback: number): number => {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`--${flag} expects a positive integer, got ${value}`)
  return number
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()

const reportPathOf = (brief: string): string => join(dirname(brief), `${basename(brief, extname(brief))}.report.md`)

const tail = (text: string): string => text.trim().slice(-STDERR_TAIL)

const inPool = async <T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const launch = async (bin: readonly string[], launcher: Launcher, job: Job): Promise<string | undefined> => {
  rmSync(job.report, { force: true })
  const result = await run([...bin, ...launcher.argv(job)], {
    cwd: job.cwd,
    timeoutMs: RUN_TIMEOUT_MS,
    input: readFileSync(job.brief, 'utf8'),
    env: { ...process.env, JIG_AGENT: job.agent },
  })
  if (result.error !== undefined) return result.error
  if (result.timedOut) return `timed out after ${RUN_TIMEOUT_MS / 60_000} min`
  if (result.code !== 0) return `exit ${result.code}: ${tail(result.stderr)}`
  if (launcher.reportFromStdout) writeFileSync(job.report, result.stdout)
  const report = isFile(job.report) ? readFileSync(job.report, 'utf8') : ''
  return report.trim() === '' ? `empty report: ${tail(result.stderr)}` : undefined
}

const checkLogin = async (agent: string, bin: readonly string[], launcher: Launcher, cwd: string): Promise<void> => {
  const result = await run([...bin, ...launcher.login], { cwd, timeoutMs: LOGIN_TIMEOUT_MS })
  if (result.error !== undefined) throw new Error(`${agent} CLI did not start: ${result.error}`)
  if (!launcher.isLoggedIn(result)) throw new Error(`${agent} is not logged in: run \`${launcher.loginHint}\``)
}

export const runSpawn: Command = async (args) => {
  const { values } = parseArgs({
    args,
    options: {
      agent: { type: 'string' },
      tier: { type: 'string' },
      effort: { type: 'string' },
      brief: { type: 'string', multiple: true },
      'max-parallel': { type: 'string' },
    },
    strict: true,
  })
  const agent = detectAgent(values.agent)
  const launcher = Object.hasOwn(LAUNCHERS, agent) ? LAUNCHERS[agent] : undefined
  if (launcher === undefined) throw new Error(`spawn launches ${Object.keys(LAUNCHERS).join(' or ')}, got agent ${agent}: pass --agent`)
  const tier: Tier = oneOf(values.tier, TIERS, 'tier')
  const effort: Effort = oneOf(values.effort, EFFORTS, 'effort')
  const maxParallel = positiveInteger(values['max-parallel'], 'max-parallel', DEFAULT_MAX_PARALLEL)
  const briefs = (values.brief ?? []).map((brief) => resolve(brief))
  if (briefs.length === 0) throw new Error('--brief <file> is required, once per subagent')
  const missing = briefs.filter((brief) => !isFile(brief))
  if (missing.length > 0) throw new Error(`brief not found: ${missing.join(', ')}`)
  const loaded = loadUserConfig()
  if (loaded.error !== undefined) throw new Error(`${loaded.label}: ${loaded.error}`)
  const model = resolveTiers(agent, loaded.config)?.[tier]?.[0]
  if (model === undefined) throw new Error(`no ${tier} model for ${agent}: set tiers.${agent}.${tier} in ${loaded.label}`)
  const cwd = process.cwd()
  const jobs = briefs.map((brief): Job => ({ agent, model, effort, cwd, brief, report: reportPathOf(brief) }))
  const clash = jobs.find((job, index) => jobs.findIndex((other) => other.report === job.report) !== index)
  if (clash !== undefined) throw new Error(`two briefs write one report ${clash.report}: rename one`)
  const bin = resolveBin(cwd, [], agent)
  if (bin === undefined) throw new Error(`${agent} CLI not found on PATH`)
  await checkLogin(agent, bin, launcher, cwd)
  const failures = await inPool(jobs, maxParallel, (job) => launch(bin, launcher, job))
  jobs.forEach((job, index) => {
    const failure = failures[index]
    if (failure === undefined) process.stdout.write(`${job.report}\n`)
    else process.stderr.write(`jig: ${job.brief}: ${failure}\n`)
  })
  return failures.some((failure) => failure !== undefined) ? 1 : 0
}
