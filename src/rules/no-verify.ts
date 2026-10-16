import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { JigConfig } from '../core/config'
import { git, gitLsFiles, gitStagedFiles } from '../core/git'
import { appendJournal } from '../core/journal'
import { resolvePluginRoot, resolveProjectRoot, toSlash } from '../core/paths'
import { MAIN_AGENT, readState, writeState } from '../core/state'
import type { Finding } from '../tools/finding'
import { activeSeverity, jigFinding } from './rule'
import { splitShell } from './shell'

type Command = (args: string[]) => number | Promise<number>

export interface NoVerifyContext {
  projectRoot: string
  sessionId: string
  config: JigConfig
}

type Bypass = 'commit' | 'other'

const RULE = 'jig/no-verify'
const ALLOWANCE_MS = 10 * 60 * 1000
const SESSION_ENV = 'CLAUDE_CODE_SESSION_ID'
const HUSKY_OFF = /^(?:\$env:)?(?:HUSKY=0|HUSKY_SKIP_HOOKS=1)$/
const GIT_BINARY = /(?:^|[/\\])git(?:\.exe)?$/i
const HOOKS_PATH_KEY = /^core\.hookspath(?:=|$)/i
const COMMIT_ARGUMENT_OPTIONS = new Set(['m', 'F', 'C', 'c', 't'])
const SHORT_CLUSTER = /^-[A-Za-z]+$/
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const OUTPUT_TOKEN = /[^\s'"`()<>,;[\]{}]+/g
const LOCATION_SUFFIX = /(?::\d+)+:?$|[:.]+$/

const isNoVerifyCluster = (token: string): boolean => {
  if (!SHORT_CLUSTER.test(token)) return false
  for (const flag of token.slice(1)) {
    if (flag === 'n') return true
    if (COMMIT_ARGUMENT_OPTIONS.has(flag)) return false
  }
  return false
}

const takesValue = (token: string): boolean =>
  SHORT_CLUSTER.test(token) && COMMIT_ARGUMENT_OPTIONS.has(token.slice(-1)) && !isNoVerifyCluster(token)

const commitSkipsHooks = (args: string[]): boolean => {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? ''
    if (arg === '--') return false
    if (arg === '--no-verify' || isNoVerifyCluster(arg)) return true
    if (takesValue(arg)) {
      index++
    }
  }
  return false
}

const gitBypass = (tokens: string[]): Bypass | undefined => {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] ?? ''
    if (token === '-c' || token === '-C') {
      const value = tokens[index + 1] ?? ''
      if (token === '-c' && HOOKS_PATH_KEY.test(value)) return 'other'
      index += 2
      continue
    }
    if (token.startsWith('-')) {
      index++
      continue
    }
    break
  }
  const subcommand = tokens[index]
  const args = tokens.slice(index + 1)
  if (subcommand === 'config' && args.some((arg) => HOOKS_PATH_KEY.test(arg))) return 'other'
  if (subcommand === 'push' && args.includes('--no-verify')) return 'other'
  if (subcommand === 'commit' && commitSkipsHooks(args)) return 'commit'
  return undefined
}

const segmentBypass = (tokens: string[]): Bypass | undefined => {
  if (tokens.some((token) => HUSKY_OFF.test(token))) return 'other'
  let result: Bypass | undefined
  tokens.forEach((token, index) => {
    if (result === 'other' || !GIT_BINARY.test(token)) return
    result = gitBypass(tokens.slice(index + 1)) ?? result
  })
  return result
}

const detectBypass = (command: string): Bypass | undefined => {
  let result: Bypass | undefined
  for (const segment of splitShell(command)) {
    const bypass = segmentBypass(segment.words)
    if (bypass === 'other') return bypass
    result = bypass ?? result
  }
  return result
}

const stagedHash = (files: readonly string[]): string =>
  createHash('sha256').update([...files].sort().join('\n')).digest('hex')

const consumeAllowance = (projectRoot: string, sessionId: string, now: number): boolean => {
  const state = readState(projectRoot, sessionId)
  const allowance = state?.noVerifyAllowance
  if (state === undefined || allowance === undefined) return false
  const isValid = !allowance.used && allowance.until > now && allowance.stagedHash === stagedHash(gitStagedFiles(projectRoot))
  if (!isValid) return false
  state.noVerifyAllowance = { ...allowance, used: true }
  writeState(projectRoot, state)
  return true
}

const jigCommand = (): string => toSlash(join(resolvePluginRoot(), 'bin', 'jig.mjs'))

export const checkNoVerify = (command: string, ctx: NoVerifyContext): Finding | undefined => {
  const severity = activeSeverity(ctx.config, RULE)
  if (severity === undefined) return undefined
  const bypass = detectBypass(command)
  if (bypass === undefined) return undefined
  if (bypass === 'commit' && consumeAllowance(ctx.projectRoot, ctx.sessionId, Date.now())) return undefined
  const message = `${RULE}: commits keep their hooks. If the pre-commit fails only on files outside your change, run: node ${jigCommand()} allow-no-verify`
  return jigFinding(RULE, severity, { file: '', line: 1, message })
}

const findRepoPaths = (output: string, projectRoot: string, tracked: ReadonlySet<string>): string[] => {
  const root = `${toSlash(projectRoot).toLowerCase()}/`
  const found = new Set<string>()
  for (const [raw] of toSlash(output.replace(ANSI, '')).matchAll(OUTPUT_TOKEN)) {
    let candidate = raw.replace(LOCATION_SUFFIX, '').replace(/^\.\//, '')
    if (candidate.toLowerCase().startsWith(root)) {
      candidate = candidate.slice(root.length)
    }
    if (tracked.has(candidate)) {
      found.add(candidate)
    }
  }
  return [...found].sort()
}

const print = (text: string): void => {
  process.stdout.write(`${text}\n`)
}

const recordAllowed = (projectRoot: string, sessionId: string, paths: string[]): void => {
  try {
    appendJournal(projectRoot, { session: sessionId, agent: MAIN_AGENT, kind: 'no-verify-allowed', rule: RULE, message: paths.join(', ') })
  } catch (error) {
    process.stderr.write(`jig: journal write failed (${error instanceof Error ? error.message : String(error)})\n`)
  }
}

export const runAllowNoVerify: Command = () => {
  const projectRoot = resolveProjectRoot(process.cwd())
  const sessionId = process.env[SESSION_ENV]
  if (!sessionId) {
    print(`jig: ${SESSION_ENV} is not set; run allow-no-verify from the agent session`)
    return 1
  }
  const state = readState(projectRoot, sessionId)
  if (state === undefined) {
    print(`jig: no jig state for session ${sessionId}`)
    return 1
  }
  const staged = gitStagedFiles(projectRoot)
  if (staged.length === 0) {
    print('jig: nothing staged')
    return 1
  }
  const hook = git(['hook', 'run', 'pre-commit'], projectRoot)
  if (hook.ok) {
    print('jig: pre-commit passes; commit without --no-verify')
    return 1
  }
  const paths = findRepoPaths(`${hook.stdout}\n${hook.stderr}`, projectRoot, new Set(gitLsFiles(projectRoot)))
  const stagedSet = new Set(staged)
  const failedStaged = paths.filter((path) => stagedSet.has(path))
  if (paths.length === 0 || failedStaged.length > 0) {
    const listed = failedStaged.length > 0 ? failedStaged.join(', ') : 'no repository paths in the pre-commit output'
    print(`jig: pre-commit fails on your staged files, fix them: ${listed}`)
    return 1
  }
  state.noVerifyAllowance = { stagedHash: stagedHash(staged), until: Date.now() + ALLOWANCE_MS, used: false }
  writeState(projectRoot, state)
  recordAllowed(projectRoot, sessionId, paths)
  print(`jig: --no-verify allowed for one commit within 10 minutes; pre-commit fails only outside your change: ${paths.join(', ')}`)
  return 0
}
