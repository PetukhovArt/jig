import { spawnSync } from 'node:child_process'

export interface GitResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

export interface GitStatusEntry {
  status: string
  path: string
}

const MAX_BUFFER = 64 * 1024 * 1024

export const git = (args: string[], cwd: string, input?: string): GitResult => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
    ...(input === undefined ? {} : { input }),
  })
  if (result.error) {
    return { ok: false, code: null, stdout: '', stderr: result.error.message }
  }
  return { ok: result.status === 0, code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const firstLine = (text: string): string | undefined => {
  const line = text.split('\n')[0]?.trim()
  return line === '' ? undefined : line
}

export const gitToplevel = (cwd: string): string | undefined => {
  const result = git(['rev-parse', '--show-toplevel'], cwd)
  return result.ok ? firstLine(result.stdout) : undefined
}

export const gitStatus = (cwd: string, paths: readonly string[] = []): GitStatusEntry[] | undefined => {
  const result = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', ...(paths.length > 0 ? ['--', ...paths] : [])], cwd)
  if (!result.ok) return undefined
  const tokens = result.stdout.split('\0')
  const entries: GitStatusEntry[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    if (token.length < 4) continue
    const status = token.slice(0, 2)
    entries.push({ status, path: token.slice(3) })
    const hasOriginalPath = status.includes('R') || status.includes('C')
    if (hasOriginalPath) {
      index++
    }
  }
  return entries
}

export const gitLsFiles = (cwd: string): string[] => {
  const result = git(['ls-files', '-z'], cwd)
  return result.ok ? result.stdout.split('\0').filter(Boolean) : []
}

export const gitStagedFiles = (cwd: string): string[] => {
  const result = git(['diff', '--cached', '--name-only', '-z'], cwd)
  return result.ok ? result.stdout.split('\0').filter(Boolean) : []
}

export const gitCurrentBranch = (cwd: string): string | undefined => {
  const result = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd)
  return result.ok ? firstLine(result.stdout) : undefined
}

export const gitShortSha = (cwd: string, length = 7): string | undefined => {
  const result = git(['rev-parse', `--short=${length}`, 'HEAD'], cwd)
  return result.ok ? firstLine(result.stdout) : undefined
}
