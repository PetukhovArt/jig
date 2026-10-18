import { createMatcher } from './glob'

export const TEST_FILE_GLOBS = ['**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/__tests__/**'] as const

export const isTestFile = createMatcher(TEST_FILE_GLOBS)
