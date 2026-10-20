import { isTestFile, languageFor, type SourceReader } from '../catalog/languages'
import type { Edit } from './rule'

const countCases = (source: string, testCase: RegExp): number => source.match(testCase)?.length ?? 0

export const addedTestCases = (file: string, edits: readonly Edit[], source?: SourceReader): number => {
  const testCase = languageFor(file)?.testCase
  if (testCase === undefined) return 0
  const added = edits.reduce((sum, edit) => sum + countCases(edit.after, testCase) - countCases(edit.before, testCase), 0)
  return added > 0 && isTestFile(file, source) ? added : 0
}
