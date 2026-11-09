import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = (): string => join(tmpdir(), 'jig-session-roots')

const fileOf = (sessionId: string): string => join(dir(), sessionId.replace(/[^A-Za-z0-9._-]/g, '_'))

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const prune = (now: number): void => {
  for (const name of readdirSync(dir())) {
    const path = join(dir(), name)
    if (now - statSync(path).mtimeMs > MAX_AGE_MS) rmSync(path, { force: true })
  }
}

export const rememberSessionRoot = (sessionId: string, root: string): void => {
  try {
    mkdirSync(dir(), { recursive: true })
    prune(Date.now())
    writeFileSync(fileOf(sessionId), root)
  } catch {
    return
  }
}

export const sessionRoot = (sessionId: string): string | undefined => {
  try {
    const root = readFileSync(fileOf(sessionId), 'utf8').trim()
    return root === '' ? undefined : root
  } catch {
    return undefined
  }
}
