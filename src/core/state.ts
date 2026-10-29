import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { jigPaths } from './paths'
import type { Snapshot } from './snapshot'

export interface EditRecord {
  path: string
  at: number
  agent: string
  via?: 'shell'
}

export interface StopState {
  lastGreenFingerprint?: string
  lastBlockFingerprint?: string
  consecutiveBlocks: number
  lastBlockDiffFingerprint?: string
}

export interface SessionState {
  v: 1
  sessionId: string
  turn: number
  createdAt: string
  updatedAt: string
  snapshot: Snapshot
  edits: EditRecord[]
  stop: StopState
  toldWorktrees?: Record<string, string[]>
}

export const MAIN_AGENT = 'main'
export const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const RENAME_ATTEMPTS = 20
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

let tmpCounter = 0

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_')

const sessionFileName = (sessionId: string): string => `${safeName(sessionId)}.json`

const shellCallPrefix = (sessionId: string): string => `${safeName(sessionId)}.shell-`

export const sessionStatePath = (projectRoot: string, sessionId: string): string =>
  join(jigPaths(projectRoot).sessions, sessionFileName(sessionId))

const shellCallPath = (projectRoot: string, sessionId: string, callId: string): string =>
  join(jigPaths(projectRoot).sessions, `${shellCallPrefix(sessionId)}${safeName(callId)}.json`)

export interface ShellCall {
  snapshot: Snapshot
  worktrees?: string[]
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

export const openShellCall = (projectRoot: string, sessionId: string, callId: string, call: ShellCall): void => {
  mkdirSync(jigPaths(projectRoot).sessions, { recursive: true })
  writeFileAtomic(shellCallPath(projectRoot, sessionId, callId), JSON.stringify(call))
}

export const closeShellCall = (projectRoot: string, sessionId: string, callId: string): ShellCall | undefined => {
  const path = shellCallPath(projectRoot, sessionId, callId)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  rmSync(path, { force: true })
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || !('snapshot' in value)) return undefined
    const { snapshot } = value
    if (typeof snapshot !== 'object' || snapshot === null) return undefined
    const worktrees = 'worktrees' in value && isStrings(value.worktrees) ? value.worktrees : undefined
    return worktrees === undefined ? { snapshot: snapshot as Snapshot } : { snapshot: snapshot as Snapshot, worktrees }
  } catch {
    return undefined
  }
}

export const openShellCalls = (projectRoot: string, sessionId: string): string[] => {
  const prefix = shellCallPrefix(sessionId)
  let names: string[]
  try {
    names = readdirSync(jigPaths(projectRoot).sessions)
  } catch {
    return []
  }
  return names.filter((name) => name.startsWith(prefix) && name.endsWith('.json')).map((name) => name.slice(prefix.length, -'.json'.length))
}

export const createSessionState = (sessionId: string, snapshot: Snapshot, now: Date = new Date()): SessionState => {
  const iso = now.toISOString()
  return {
    v: 1,
    sessionId,
    turn: 0,
    createdAt: iso,
    updatedAt: iso,
    snapshot,
    edits: [],
    stop: { consecutiveBlocks: 0 },
  }
}

export const resetSnapshot = (state: SessionState, snapshot: Snapshot): void => {
  state.snapshot = snapshot
  state.edits = []
}

const isSessionState =(value: unknown): value is SessionState => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SessionState>
  return candidate.v === 1 && typeof candidate.sessionId === 'string' && typeof candidate.snapshot === 'object'
}

export const readState = (projectRoot: string, sessionId: string): SessionState | undefined => {
  let text: string
  try {
    text = readFileSync(sessionStatePath(projectRoot, sessionId), 'utf8')
  } catch {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(text)
    if (!isSessionState(value)) return undefined
    return { ...value, turn: typeof value.turn === 'number' ? value.turn : 0 }
  } catch {
    return undefined
  }
}

const isRetryable = (error: unknown): boolean =>
  error instanceof Error && RENAME_RETRY_CODES.has((error as NodeJS.ErrnoException).code ?? '')

const renameWithRetry = (from: string, to: string): void => {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isRetryable(error)) {
        rmSync(from, { force: true })
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 5)
    }
  }
}

export const writeFileAtomic = (path: string, text: string): void => {
  tmpCounter++
  const tmp = `${path}.${process.pid}-${tmpCounter}.tmp`
  writeFileSync(tmp, text)
  renameWithRetry(tmp, path)
}

export const writeState = (projectRoot: string, state: SessionState, now: Date = new Date()): void => {
  const path = sessionStatePath(projectRoot, state.sessionId)
  mkdirSync(jigPaths(projectRoot).sessions, { recursive: true })
  state.updatedAt = now.toISOString()
  writeFileAtomic(path, JSON.stringify(state))
}

export const pruneStates = (projectRoot: string, now: number = Date.now(), maxAgeMs: number = STATE_MAX_AGE_MS): string[] => {
  const dir = jigPaths(projectRoot).sessions
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      if (now - statSync(path).mtimeMs <= maxAgeMs) continue
      rmSync(path, { force: true })
      removed.push(name)
    } catch {
      continue
    }
  }
  return removed
}
