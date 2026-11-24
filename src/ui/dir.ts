import { join } from 'node:path'
import { ensureJigDir, jigPaths } from '../core/paths'
import { branchDirName } from '../task-status/task-status'

export const DEVIATIONS_FILE = 'deviations.md'
export const EVIDENCE_PAGE = 'index.html'

export const uiBranchDir = (root: string): string => join(ensureJigDir(root).ui, branchDirName(root))

export const existingUiBranchDir = (root: string): string => join(jigPaths(root).ui, branchDirName(root))
