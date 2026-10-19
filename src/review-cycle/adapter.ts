import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { findInPath } from '../core/proc'
import { BlockedRefError, EnvironmentError, firstLine, type Exec } from './exec'
import type { Forge } from './forge'

export const TRANSITIONS = ['returned', 'ready', 'none'] as const
export type Transition = (typeof TRANSITIONS)[number]

export interface QueueRow {
  refs: string
  repoDir: string
  iid: number
  sourceBranch: string
  draft: boolean
  approved: boolean
  webUrl: string
}

export interface QueueNote {
  refs: string
  text: string
}

export interface Queue {
  rows: QueueRow[]
  notes: QueueNote[]
}

/** The team's review process: what triggers a review, where a verdict is recorded, where the task text lives. */
export interface ProcessAdapter {
  readonly label: string
  queue(): Queue
  /** `stale=on|off` and any other `key=value` line for these refs. */
  rules(refs: string): Map<string, string>
  /** A spec file path for these refs, or undefined. */
  spec(refs: string): string | undefined
  /** `- ` bullets of the project's own checks, maybe none. */
  baseCheck(): string[]
  /** Lines to print; throws BlockedRefError (exit 4) or EnvironmentError (exit 3). */
  transition(ref: string, target: Transition): string[]
}

/** Git Bash's paths (`/c/Users/...`) as Windows paths, so node can open them. */
export const nativePath = (path: string, platform: NodeJS.Platform = process.platform): string => {
  if (platform !== 'win32') return path
  const drive = /^\/([a-zA-Z])(\/.*)?$/.exec(path)
  return drive?.[1] === undefined ? path : `${drive[1].toUpperCase()}:${drive[2] ?? '/'}`
}

const truthy = (value: string): boolean => /^(true|1|yes)$/i.test(value.trim())

export const parseQueue = (output: string, platform: NodeJS.Platform = process.platform): Queue => {
  const queue: Queue = { rows: [], notes: [] }
  for (const line of output.split(/\r?\n/)) {
    const [kind, ...cells] = line.split('\t')
    if (kind === 'NOTE') {
      queue.notes.push({ refs: cells[0] ?? '', text: cells.slice(1).join('\t') })
      continue
    }
    if (kind !== 'ROW') continue
    const [refs, repoDir, iid, sourceBranch, draft, approval, webUrl] = cells
    if (refs === undefined || repoDir === undefined || webUrl === undefined || !/^\d+$/.test(iid ?? '')) {
      throw new EnvironmentError(`adapter queue: malformed row: ${line}`)
    }
    queue.rows.push({
      refs,
      repoDir: nativePath(repoDir, platform),
      iid: Number(iid),
      sourceBranch: sourceBranch ?? '',
      draft: truthy(draft ?? ''),
      approved: approval === 'APPROVED',
      webUrl,
    })
  }
  return queue
}

export const parseRules = (output: string): Map<string, string> =>
  new Map(
    output
      .split(/\r?\n/)
      .map((line) => /^([\w-]+)=(.*)$/.exec(line.trim()))
      .flatMap((match) => (match?.[1] === undefined ? [] : [[match[1], (match[2] ?? '').trim()] as [string, string]])),
  )

const lines = (output: string): string[] => output.split(/\r?\n/).filter((line) => line.trim() !== '')

/** On Windows, Git for Windows' bash: the `bash` first in PATH is often WSL's, which cannot see Windows paths. */
export const findBash = (env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined => {
  const fromEnv = env['JIG_BASH']
  if (fromEnv) return fromEnv
  if (platform !== 'win32') return findInPath('bash', env)
  const git = findInPath('git', env)
  if (git !== undefined) {
    for (const root of [dirname(dirname(git)), dirname(dirname(dirname(git)))]) {
      const candidate = join(root, 'bin', 'bash.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  const bash = findInPath('bash', env)
  return bash !== undefined && !/system32/i.test(bash) ? bash : undefined
}

/** How to start an adapter: node for JavaScript, bash for shell, PowerShell for .ps1, else the file itself. */
export const adapterCommand = (path: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] => {
  const extension = extname(path).toLowerCase()
  if (['.mjs', '.js', '.cjs'].includes(extension)) return [process.execPath, path]
  if (extension === '.sh') {
    const bash = findBash(env, platform)
    if (bash === undefined) throw new EnvironmentError(`no bash to run ${path}: install Git for Windows or set JIG_BASH`)
    return [bash, path]
  }
  if (extension === '.ps1') return [platform === 'win32' ? 'powershell' : 'pwsh', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path]
  return [path]
}

/** `~/` is the home directory; a relative path is relative to `base` (the project root for the config, the cwd for a flag). */
export const resolveAdapterPath = (path: string, base: string): string => {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1))
  return isAbsolute(path) ? path : resolve(base, path)
}

export const scriptAdapter = (path: string, exec: Exec, cwd: string): ProcessAdapter => {
  if (!existsSync(path)) throw new EnvironmentError(`process adapter not found: ${path}`)
  const [command, ...prefix] = adapterCommand(path)
  if (command === undefined) throw new EnvironmentError(`process adapter: cannot run ${path}`)
  const op = (args: string[]): string => {
    const result = exec(command, [...prefix, ...args], cwd)
    const reason = result.error ?? (firstLine(result.stderr).replace(/^ERROR\s+/, '') || `exit ${String(result.code)}`)
    if (result.code === 0) return result.stdout
    if (result.code === 4) throw new BlockedRefError(reason)
    throw new EnvironmentError(`adapter ${args[0] ?? ''}: ${reason}`)
  }
  return {
    label: path,
    queue: () => parseQueue(op(['queue'])),
    rules: (refs) => parseRules(op(['rules', refs])),
    spec: (refs) => lines(op(['spec', refs]))[0]?.trim(),
    baseCheck: () => lines(op(['base-check'])).filter((line) => line.startsWith('- ')),
    transition: (ref, target) => lines(op(['transition', ref, target])),
  }
}

/** No adapter: the queue is the forge's open merge requests with the current user as a reviewer; no tracker, no transitions. */
export const defaultAdapter = (forge: Forge, repoDir: string): ProcessAdapter => ({
  label: `built-in (${forge.name} reviewer queue)`,
  queue: () => ({
    rows: forge.reviewQueue().map((request) => ({
      refs: `!${request.iid}`,
      repoDir,
      iid: request.iid,
      sourceBranch: request.sourceBranch,
      draft: request.draft,
      approved: forge.approved(request.iid),
      webUrl: request.webUrl,
    })),
    notes: [],
  }),
  rules: () => new Map([['stale', 'on']]),
  spec: () => undefined,
  baseCheck: () => [],
  transition: (ref, target) => [`${ref} → ${target}: no process adapter, nothing recorded`],
})
