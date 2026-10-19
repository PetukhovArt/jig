import { extname } from 'node:path'
import { createMatcher } from '../../core/glob'
import { lexJs, lexVue, type Comment } from './js-lexer'

export type { Comment, CommentKind } from './js-lexer'

export interface Language {
  name: string
  extensions: readonly string[]
  lexComments: (source: string) => Comment[]
  testFiles: readonly string[]
  testCase?: RegExp
}

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const

export const LANGUAGES: readonly Language[] = [
  {
    name: 'javascript',
    extensions: SCRIPT_EXTENSIONS,
    lexComments: lexJs,
    testFiles: ['**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/__tests__/**'],
    testCase: /(?<![\w$.])(?:it|test)(?:\.\w+)*\s*\(/g,
  },
  { name: 'vue', extensions: ['.vue'], lexComments: lexVue, testFiles: [] },
]

export const SCRIPT_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}'] as const

export const TYPED_FILES = ['**/*.{ts,tsx,mts,cts,vue}'] as const

export const TEST_FILE_GLOBS: readonly string[] = [...new Set(LANGUAGES.flatMap((language) => language.testFiles))]

export const isTestFile = createMatcher(TEST_FILE_GLOBS)

export const languageFor = (file: string): Language | undefined => {
  const extension = extname(file).toLowerCase()
  return LANGUAGES.find((language) => language.extensions.includes(extension))
}

export const lexComments = (file: string, source: string): Comment[] | undefined => languageFor(file)?.lexComments(source)
