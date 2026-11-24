import { spawnSync } from 'node:child_process'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

export type CommandRunner = (command: string, cwd: string) => CommandResult

const CALL_TIMEOUT_MS = 300_000
const MAX_BUFFER = 64 * 1024 * 1024

export const shellRunner: CommandRunner = (command, cwd) => {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: CALL_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true })
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error.message }),
  }
}

const quoted = (value: string): string => `"${value.replace(/"/g, '\\"')}"`

export const fillTemplate = (template: string, values: Readonly<Record<string, string | number | undefined>>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    if (value === undefined) return quoted('')
    return typeof value === 'number' ? String(value) : quoted(value)
  })

const ERROR_LINE = /^(?:\w*Error|error)\b/

export const failureOf = (result: CommandResult): string => {
  if (result.error !== undefined) return result.error
  const lines = (result.stderr.trim() || result.stdout.trim()).split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.find((line) => ERROR_LINE.test(line)) ?? lines.at(-1) ?? `exit ${result.code}`
}
