import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export interface TypeCheckScript {
  script: string
  command: string
  takesFiles: boolean
  reason: string | undefined
}

export interface TypeCheckDetection {
  script: TypeCheckScript | undefined
  globs: string[]
}

const ROOT_MANIFEST = 'package.json'
const FILE_TAKING_CHECKER = /(^|[\s/\\])ts-decl-check(\.[cm]?js)?(\s|$)/
const TYPE_CHECK_NAME = /^(typecheck|type-check|types|tsc|check[:-]types?|types?[:-]check|typecheck:.+|type-check:.+)$/
const SHELL_OPERATOR = /&&|\|\||[|;<>`]|\$\(/
const TYPED_GLOBS: readonly (readonly [string, string])[] = [
  ['.ts', '**/*.ts'],
  ['.tsx', '**/*.tsx'],
  ['.mts', '**/*.mts'],
  ['.cts', '**/*.cts'],
  ['.vue', '**/*.vue'],
]

const readScripts = (projectRoot: string): Record<string, string> => {
  try {
    const manifest = JSON.parse(readFileSync(join(projectRoot, ROOT_MANIFEST), 'utf8')) as Record<string, unknown>
    const scripts = manifest['scripts']
    if (typeof scripts !== 'object' || scripts === null) return {}
    return Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

const judge = (script: string, command: string): TypeCheckScript => {
  if (SHELL_OPERATOR.test(command)) return { script, command, takesFiles: false, reason: 'it uses shell operators, and a check runs without a shell' }
  if (!FILE_TAKING_CHECKER.test(command)) return { script, command, takesFiles: false, reason: 'it takes no file list' }
  return { script, command, takesFiles: true, reason: undefined }
}

export const detectTypeCheck = (projectRoot: string, files: readonly string[]): TypeCheckDetection => {
  const scripts = Object.entries(readScripts(projectRoot))
  const takingFiles = scripts.find(([, command]) => FILE_TAKING_CHECKER.test(command) && !SHELL_OPERATOR.test(command))
  const namedLikeTypeCheck = scripts.find(([name, command]) => TYPE_CHECK_NAME.test(name) || FILE_TAKING_CHECKER.test(command))
  const chosen = takingFiles ?? namedLikeTypeCheck
  const extensions = new Set(files.filter((file) => !file.endsWith('.d.ts')).map((file) => posix.extname(file)))
  const globs = TYPED_GLOBS.filter(([extension]) => extensions.has(extension)).map(([, glob]) => glob)
  return { script: chosen === undefined ? undefined : judge(chosen[0], chosen[1]), globs }
}

export const TYPES_CHECK_NAME = 'types'

export const typesCheck = (detection: TypeCheckDetection): Record<string, unknown> | undefined => {
  const { script, globs } = detection
  if (script?.takesFiles !== true || globs.length === 0) return undefined
  return { name: TYPES_CHECK_NAME, files: globs, on: 'stop', run: `${script.command} {files}` }
}
