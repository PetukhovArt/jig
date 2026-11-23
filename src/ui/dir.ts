import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureJigDir, jigPaths } from '../core/paths'
import { branchDirName } from '../task-status/task-status'

export const REFERENCE_FILE = 'reference'
export const DEVIATIONS_FILE = 'deviations.md'
export const EVIDENCE_PAGE = 'index.html'

export const uiBranchDir = (root: string): string => join(ensureJigDir(root).ui, branchDirName(root))

const referenceFile = (root: string): string => join(uiBranchDir(root), REFERENCE_FILE)

export const declareReference = (root: string, reference: string): void => {
  mkdirSync(uiBranchDir(root), { recursive: true })
  writeFileSync(referenceFile(root), `${reference}\n`)
}

export const declaredReference = (root: string): string | undefined => {
  const file = join(jigPaths(root).ui, branchDirName(root), REFERENCE_FILE)
  if (!existsSync(file)) return undefined
  const text = readFileSync(file, 'utf8').trim()
  return text === '' ? undefined : text
}

export const declaresFigma = (reference: string | undefined): boolean => reference?.startsWith('figma:') === true
