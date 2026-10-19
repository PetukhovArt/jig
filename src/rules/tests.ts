import { isTestFile } from '../core/test-files'
import type { Edit } from './rule'

const TEST_CASE = /(?<![\w$.])(?:it|test)(?:\.\w+)*\s*\(/g

const countCases = (source: string): number => source.match(TEST_CASE)?.length ?? 0

export const addedTestCases = (file: string, edits: readonly Edit[]): number =>
  isTestFile(file) ? edits.reduce((sum, edit) => sum + countCases(edit.after) - countCases(edit.before), 0) : 0
