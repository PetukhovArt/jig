import { isTestFile, languageFor } from '../catalog/languages'
import type { Edit } from './rule'

const countCases = (source: string, testCase: RegExp): number => source.match(testCase)?.length ?? 0

export const addedTestCases = (file: string, edits: readonly Edit[]): number => {
  const testCase = languageFor(file)?.testCase
  if (testCase === undefined || !isTestFile(file)) return 0
  return edits.reduce((sum, edit) => sum + countCases(edit.after, testCase) - countCases(edit.before, testCase), 0)
}
