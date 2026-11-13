import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createMatcher, type PathMatcher } from '../../core/glob'
import { lexGo, lexRust } from './c-style-lexer'
import { lexCSharp } from './csharp-lexer'
import { lexCss, lexScss } from './css-lexer'
import { lexPython, lexShell } from './hash-lexers'
import { lexJs, lexTs } from './js-lexer'
import type { Comment } from './lexer'
import { lexMarkup, lexVue } from './markup-lexer'

export type { Comment, CommentKind } from './lexer'

export type SourceReader = () => string | undefined

export interface Language {
  name: string
  extensions: readonly string[]
  lexComments: (source: string) => Comment[]
  isTestPath?: PathMatcher
  testCase?: RegExp
  testFile?: RegExp
}

const isScriptTestPath = createMatcher(['**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', '**/__tests__/**'])

const TEST_SEGMENT = /^(?:tests?|__tests__|_tests_|spec)$/i
const TEST_AFFIX = /^[Tt]ests?(?![a-z])|(?:^|[^A-Za-z])[Tt]ests?$|[a-z\d]Tests?$/

const isTestSegmentPath = (file: string): boolean => {
  const segments = file.replace(/\\/g, '/').split('/')
  const name = segments.pop() ?? ''
  return [...segments, name.slice(0, name.length - extname(name).length)].some((segment) => TEST_SEGMENT.test(segment) || TEST_AFFIX.test(segment))
}

const CSHARP_TEST_ATTRIBUTE = String.raw`\[\s*(?:\w+\.)*(?:Fact|Theory|Test|TestCase|TestCaseSource|TestMethod|DataTestMethod)(?:Attribute)?(?=\s*[(\],])`
const CSHARP_TEST_CASE = String.raw`(?<![\w)]\s*)(?<!${CSHARP_TEST_ATTRIBUTE}[^\n]*\]\s*)${CSHARP_TEST_ATTRIBUTE}`

const SCRIPT_TESTS = {
  isTestPath: isScriptTestPath,
  testCase: /(?<![\w$.])(?:it|test)(?:\.\w+)*\s*\(/g,
  testFile: /^\s*(?:describe|it|test)(?:\.\w+)*\s*(?:\([^\n]*?\)\s*)?\(\s*['"`]/m,
}

export const LANGUAGES: readonly Language[] = [
  { name: 'javascript', extensions: ['.ts', '.mts', '.cts'], lexComments: lexTs, ...SCRIPT_TESTS },
  { name: 'javascript', extensions: ['.tsx', '.js', '.jsx', '.mjs', '.cjs'], lexComments: lexJs, ...SCRIPT_TESTS },
  { name: 'vue', extensions: ['.vue'], lexComments: lexVue },
  { name: 'html', extensions: ['.html', '.htm', '.svelte'], lexComments: lexMarkup },
  { name: 'css', extensions: ['.css'], lexComments: lexCss },
  { name: 'scss', extensions: ['.scss', '.less'], lexComments: lexScss },
  { name: 'python', extensions: ['.py', '.pyi'], lexComments: lexPython },
  { name: 'shell', extensions: ['.sh', '.bash', '.zsh'], lexComments: lexShell },
  { name: 'rust', extensions: ['.rs'], lexComments: lexRust },
  { name: 'go', extensions: ['.go'], lexComments: lexGo },
  {
    name: 'csharp',
    extensions: ['.cs'],
    lexComments: lexCSharp,
    isTestPath: isTestSegmentPath,
    testCase: new RegExp(CSHARP_TEST_CASE, 'g'),
    testFile: new RegExp(CSHARP_TEST_CASE),
  },
]

export const SCRIPT_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}'] as const

export const TYPED_FILES = ['**/*.{ts,tsx,mts,cts,vue}'] as const

export const languageFor = (file: string): Language | undefined => {
  const extension = extname(file).toLowerCase()
  return LANGUAGES.find((language) => language.extensions.includes(extension))
}

export const fileSource =
  (root: string, file: string): SourceReader =>
  () => {
    try {
      return readFileSync(join(root, file), 'utf8')
    } catch {
      return undefined
    }
  }

export const isTestFile = (file: string, source?: SourceReader): boolean => {
  const language = languageFor(file)
  if ((language?.isTestPath ?? isScriptTestPath)(file)) return true
  const pattern = language?.testFile
  if (pattern === undefined || source === undefined) return false
  const text = source()
  return text !== undefined && pattern.test(text)
}

export const lexComments = (file: string, source: string): Comment[] | undefined => languageFor(file)?.lexComments(source)
