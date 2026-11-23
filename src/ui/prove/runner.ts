import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { AGENT_VIEW_BINARY, AGENT_VIEW_CONFIG } from '../../catalog/proofs/agent-view'
import { resolveBin } from '../../core/proc'

export interface RunnerResult {
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

export type AgentViewRunner = (args: string[], cwd: string) => RunnerResult

const CALL_TIMEOUT_MS = 300_000
const MAX_BUFFER = 64 * 1024 * 1024

export const spawnAgentView = (root: string): AgentViewRunner => {
  const argv = resolveBin(root, AGENT_VIEW_BINARY.packages, AGENT_VIEW_BINARY.command)
  return (args, cwd) => {
    if (argv === undefined) return { code: null, stdout: '', stderr: '', error: 'agent-view is not installed: npm i -g @petukhovart/agent-view' }
    const [command, ...prefix] = argv
    const result = spawnSync(command ?? '', [...prefix, ...args], { cwd, encoding: 'utf8', timeout: CALL_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true })
    return {
      code: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      ...(result.error === undefined ? {} : { error: result.error.message }),
    }
  }
}

export const findAgentViewConfig = (root: string): string | undefined => {
  let dir = resolve(root)
  for (;;) {
    const file = join(dir, AGENT_VIEW_CONFIG)
    if (existsSync(file)) return file
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export const hasSceneHook = (configFile: string): boolean => {
  try {
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as { webgl?: { engine?: unknown } }
    return config.webgl?.engine === 'app-hook'
  } catch {
    return false
  }
}

const ERROR_LINE = /^(?:\w*Error|error)\b/

export const failureOf = (result: RunnerResult): string => {
  if (result.error !== undefined) return result.error
  const lines = (result.stderr.trim() || result.stdout.trim()).split('\n').map((line) => line.trim()).filter(Boolean)
  const reason = lines.find((line) => ERROR_LINE.test(line)) ?? lines.at(-1)
  if (reason === undefined) return `exit ${result.code}`
  return /unknown command/.test(reason) ? `${reason} (this agent-view is too old for emulate and audit: update @petukhovart/agent-view)` : reason
}
