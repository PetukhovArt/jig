import { spawnSync } from 'node:child_process'

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

/** The process boundary of the review cycle: every forge CLI and adapter call goes through it. */
export type Exec = (command: string, args: readonly string[], cwd: string) => ExecResult

const MAX_BUFFER = 256 * 1024 * 1024

export const spawnExec: Exec = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: MAX_BUFFER })
  if (result.error) return { code: null, stdout: '', stderr: '', error: result.error.message }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Exit 3: the environment could not answer. Never a verdict: the caller blocks or aborts, it never guesses. */
export class EnvironmentError extends Error {
  readonly exitCode = 3
}

/** Exit 4 from an adapter: this ref is blocked, the reason goes to the summary and the cycle goes on. */
export class BlockedRefError extends Error {
  readonly exitCode = 4
}

export const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? ''

/**
 * Parses one JSON value or several concatenated ones (`glab api --paginate` prints one array per
 * page with nothing between them) and flattens the arrays into one list.
 */
export const parseJsonPages = (text: string): unknown[] => {
  const values: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '[' || char === '{') {
      if (depth === 0) start = index
      depth++
    } else if (char === ']' || char === '}') {
      depth--
      if (depth === 0) values.push(JSON.parse(text.slice(start, index + 1)))
    }
  }
  if (depth !== 0 || inString) throw new Error('truncated JSON')
  return values.flatMap((value) => (Array.isArray(value) ? value : [value]))
}
