import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createMatcher, type PathMatcher } from '../../core/glob'
import { lexCSharp } from './csharp-lexer'
import { lexJs, lexVue, type Comment } from './js-lexer'

export type { Comment, CommentKind } from './js-lexer'

export type SourceReader = () => string | undefined

export interface Language {
  name: string
  extensions: readonly string[]
  lexComments: (source: string) => Comment[]
  isTestPath?: PathMatcher
  testCase?: RegExp
  testFile?: RegExp
}

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const

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

export const LANGUAGES: readonly Language[] = [
  {
    name: 'javascript',
    extensions: SCRIPT_EXTENSIONS,
    lexComments: lexJs,
    isTestPath: isScriptTestPath,
    testCase: /(?<![\w$.])(?:it|test)(?:\.\w+)*\s*\(/g,
    testFile: /^\s*(?:describe|it|test)(?:\.\w+)*\s*(?:\([^\n]*?\)\s*)?\(\s*['"`]/m,
  },
  { name: 'vue', extensions: ['.vue'], lexComments: lexVue },
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
