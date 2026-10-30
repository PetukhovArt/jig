import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from '../core/git'

const HOLD_WINDOW_MS = 2 * 60 * 60 * 1000
const MAX_ANCESTORS = 12
const REFLOG_LIMIT = '50'
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh', 'conhost'])

const SESSION_ENV: readonly (readonly [variable: string, agent: string])[] = [
  ['CLAUDE_CODE_SESSION_ID', 'claude'],
  ['CLAUDE_SESSION_ID', 'claude'],
]

export interface ProcessInfo {
  ppid: number
  name: string
}

const processInfoOf = (pid: number): ProcessInfo | undefined => {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell',
          ['-NoProfile', '-Command', `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { "$($p.ParentProcessId) $($p.Name)" }`],
          { encoding: 'utf8', windowsHide: true },
        )
      : spawnSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' })
  const match = result.status === 0 ? /^\s*(\d+)\s+(.+?)\s*$/m.exec(result.stdout) : null
  return match?.[1] === undefined || match[2] === undefined ? undefined : { ppid: Number(match[1]), name: match[2] }
}

const isShell = (name: string): boolean => SHELLS.has(name.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase())

const firstNonShellAncestor = (ppid: number, infoOf: (pid: number) => ProcessInfo | undefined): number => {
  let pid = ppid
  for (let depth = 0; depth < MAX_ANCESTORS; depth++) {
    const info = infoOf(pid)
    if (info === undefined || !isShell(info.name) || info.ppid <= 1) return pid
    pid = info.ppid
  }
  return pid
}

export interface OwnerQuery {
  flag?: string | undefined
  env?: NodeJS.ProcessEnv
  ppid?: number
  infoOf?: (pid: number) => ProcessInfo | undefined
}

export const ownerIdOf = ({ flag, env = process.env, ppid = process.ppid, infoOf = processInfoOf }: OwnerQuery): string => {
  if (flag !== undefined && flag !== '') return flag
  for (const [variable, agent] of SESSION_ENV) {
    const value = env[variable]
    if (value !== undefined && value !== '') return `${agent}:${value}`
  }
  return `pid:${firstNonShellAncestor(ppid, infoOf)}`
}

interface OwnerMarker {
  owner: string
  commit: string
  at: number
}

export const ownerMarkerPath = (dir: string): string => {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], dir)
  return join(gitDir.ok ? gitDir.stdout.trim() : join(dir, '.git'), 'jig', 'slot-owner.json')
}

const readOwner = (dir: string): OwnerMarker | undefined => {
  try {
    const marker = JSON.parse(readFileSync(ownerMarkerPath(dir), 'utf8')) as Partial<OwnerMarker>
    return typeof marker.owner === 'string' && typeof marker.commit === 'string' && typeof marker.at === 'number' ? (marker as OwnerMarker) : undefined
  } catch {
    return undefined
  }
}

export const writeOwner = (dir: string, { owner, commit, now = Date.now() }: { owner: string; commit: string; now?: number }): void => {
  const path = ownerMarkerPath(dir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ owner, commit, at: now })}\n`)
}

export const clearOwner = (dir: string): void => {
  rmSync(ownerMarkerPath(dir), { force: true })
}

const minutesOf = (ms: number): number => Math.max(0, Math.round(ms / 60_000))

const recentCheckoutEntry = (dir: string, now: number): string | undefined => {
  const log = git(['reflog', 'show', '--date=unix', '--format=%gd%x09%gs', '-n', REFLOG_LIMIT, 'HEAD'], dir)
  if (!log.ok) return undefined
  const lines = log.stdout.split(/\r?\n/).filter(Boolean)
  for (const [index, line] of lines.entries()) {
    const [selector, subject] = line.split('\t')
    const seconds = Number(/\{(\d+)\}$/.exec(selector ?? '')?.[1])
    if (subject === undefined || !subject.startsWith('checkout:') || !Number.isFinite(seconds)) continue
    const age = now - seconds * 1000
    return age > HOLD_WINDOW_MS ? undefined : `HEAD@{${index}}: ${subject} (${minutesOf(age)} min ago)`
  }
  return undefined
}

export const refusalOf = ({ dir, owner, now = Date.now() }: { dir: string; owner: string; now?: number }): string | undefined => {
  const marker = readOwner(dir)
  if (marker === undefined || marker.owner === owner) return undefined
  const age = now - marker.at
  if (age < HOLD_WINDOW_MS) return `held by ${marker.owner}, which showed ${marker.commit.slice(0, 7)} ${minutesOf(age)} min ago`
  const head = git(['rev-parse', 'HEAD'], dir)
  if (!head.ok || head.stdout.trim() === marker.commit) return undefined
  const entry = recentCheckoutEntry(dir, now)
  return entry === undefined ? undefined : `moved by a git checkout outside jig since ${marker.owner} showed ${marker.commit.slice(0, 7)}: ${entry}`
}
