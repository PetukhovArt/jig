import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { jigPaths } from './paths'
import type { ProofKind } from '../checks/check'
import type { Snapshot } from './snapshot'

export interface EditRecord {
  path: string
  at: number
  agent: string
}

export interface StopState {
  lastGreenFingerprint?: string
  lastBlockFingerprint?: string
  consecutiveBlocks: number
  lastBlockDiffFingerprint?: string
}

export interface ProofTimes {
  editAt?: number
  proofAt?: number
}

export type CheckTimes = Record<string, Partial<Record<ProofKind, ProofTimes>>>

export interface NoVerifyAllowance {
  stagedHash: string
  until: number
  used: boolean
}

export interface SessionState {
  v: 1
  sessionId: string
  turn: number
  createdAt: string
  updatedAt: string
  snapshot: Snapshot
  edits: EditRecord[]
  lastTestEditAt?: number
  testReviewAt?: number
  checks: CheckTimes
  testChecklistShown: boolean
  delivered: Record<string, string[]>
  sessionAtoms: string[]
  pendingWarnings: string[]
  stop: StopState
  noVerifyAllowance?: NoVerifyAllowance
}

export const MAIN_AGENT = 'main'
export const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const RENAME_ATTEMPTS = 20
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

let tmpCounter = 0

const sessionFileName = (sessionId: string): string => `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`

export const sessionStatePath = (projectRoot: string, sessionId: string): string =>
  join(jigPaths(projectRoot).sessions, sessionFileName(sessionId))

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
    checks: {},
    testChecklistShown: false,
    delivered: {},
    sessionAtoms: [],
    pendingWarnings: [],
    stop: { consecutiveBlocks: 0 },
  }
}

export const resetSnapshot = (state: SessionState, snapshot: Snapshot): void => {
  state.snapshot = snapshot
  state.edits = []
}

export const stampCheck = (state: SessionState, check: string, kinds: readonly ProofKind[], field: keyof ProofTimes, at: number): void => {
  if (kinds.length === 0) return
  const times = state.checks[check] ?? {}
  for (const kind of kinds) {
    times[kind] = { ...times[kind], [field]: at }
  }
  state.checks[check] = times
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
    const checks = typeof value.checks === 'object' && value.checks !== null ? value.checks : {}
    return { ...value, turn: typeof value.turn === 'number' ? value.turn : 0, checks }
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
