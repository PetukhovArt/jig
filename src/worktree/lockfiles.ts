import { posix } from 'node:path'
import table from './lockfiles.json'

export interface Lockfile {
  file: string
  install: string
}

export interface InstallStep {
  dir: string
  command: string
}

export const LOCKFILES: readonly Lockfile[] = table

/**
 * Install steps for the lock files among `changed` (repo-relative paths, as `git diff --name-only`
 * prints them). A configured `install` command wins and runs once at the root; otherwise the package
 * manager comes from the lock file's name and runs in the lock file's folder.
 */
export const installSteps = (
  changed: readonly string[],
  install: string | undefined,
  lockfiles: readonly Lockfile[] = LOCKFILES,
): InstallStep[] => {
  const byName = new Map(lockfiles.map((lockfile) => [lockfile.file, lockfile.install]))
  const detected = changed.flatMap((raw) => {
    const path = raw.replace(/\\/g, '/')
    const command = byName.get(posix.basename(path))
    return command === undefined ? [] : [{ dir: posix.dirname(path), command }]
  })
  if (detected.length === 0) return []
  if (install !== undefined) return [{ dir: '.', command: install }]
  return [...new Map(detected.map((step) => [`${step.dir}\0${step.command}`, step])).values()]
}
