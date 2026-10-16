import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, gitToplevel } from './git'
import { toProjectPath } from './paths'

export interface FileStamp {
  mtimeMs: number
  size: number
}

export type Snapshot = Record<string, FileStamp>

export interface TurnDiff {
  files: string[]
  stamps: Snapshot
  fingerprint: string
}

const stampOf = (absolutePath: string): FileStamp | undefined => {
  try {
    const stat = statSync(absolutePath)
    return stat.isFile() ? { mtimeMs: stat.mtimeMs, size: stat.size } : undefined
  } catch {
    return undefined
  }
}

const isInsideProject = (path: string): boolean => path !== '' && !path.startsWith('../') && path !== '..'

const changedFiles = (projectRoot: string): string[] => {
  const top = gitToplevel(projectRoot)
  if (top === undefined) return []
  const entries = gitStatus(top) ?? []
  return entries.map((entry) => toProjectPath(projectRoot, join(top, entry.path))).filter(isInsideProject)
}

export const takeSnapshot = (projectRoot: string): Snapshot => {
  const snapshot: Snapshot = {}
  for (const path of changedFiles(projectRoot)) {
    const stamp = stampOf(join(projectRoot, path))
    if (stamp !== undefined) {
      snapshot[path] = stamp
    }
  }
  return snapshot
}

const isSameStamp = (left: FileStamp | undefined, right: FileStamp): boolean =>
  left !== undefined && left.mtimeMs === right.mtimeMs && left.size === right.size

export const diffFingerprint = (stamps: Snapshot): string => {
  const lines = Object.keys(stamps)
    .sort()
    .map((path) => `${path}:${stamps[path]?.mtimeMs}:${stamps[path]?.size}`)
  return createHash('sha1').update(lines.join('\n')).digest('hex')
}

export const turnDiff = (projectRoot: string, snapshot: Snapshot, edits: readonly { path: string }[]): TurnDiff => {
  const stamps: Snapshot = {}
  for (const { path } of edits) {
    const stamp = stampOf(join(projectRoot, path))
    if (stamp !== undefined) {
      stamps[path] = stamp
    }
  }
  for (const path of changedFiles(projectRoot)) {
    if (Object.hasOwn(stamps, path)) continue
    const stamp = stampOf(join(projectRoot, path))
    if (stamp === undefined || isSameStamp(snapshot[path], stamp)) continue
    stamps[path] = stamp
  }
  const files = Object.keys(stamps).sort()
  return { files, stamps, fingerprint: diffFingerprint(stamps) }
}
