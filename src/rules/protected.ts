import { isAbsolute, posix } from 'node:path'
import type { JigConfig } from '../core/config'
import { createMatcher } from '../core/glob'
import { toProjectPath, toSlash } from '../core/paths'
import type { Finding } from '../tools/finding'
import { activeSeverity, jigFinding } from './rule'
import { splitShell } from './shell'

const RULE = 'jig/protected-paths'

export const PROTECTED_GLOBS: readonly string[] = [
  '.jig/config.jsonc',
  '.jig/config.json',
  'eslint.config.*',
  '.eslintrc',
  '.eslintrc.*',
  '.oxlintrc.json',
  'oxlint.json',
  'oxlintrc.json',
  'tsconfig*.json',
  '**/tsconfig*.json',
  'jsconfig*.json',
  'stratum.config.jsonc',
  '**/*stratum*baseline*',
  '.betterer.results',
  '.gitlab-ci.yml',
  '.gitlab/**',
  '.github/workflows/**',
  '.husky/**',
  'lefthook.yml',
  'lefthook.yaml',
  '.lintstagedrc',
  '.lintstagedrc.*',
  'lint-staged.config.*',
  '.claude/settings.json',
]

type TargetPicker = (args: string[]) => string[]

const ASSIGNMENT = /^[A-Za-z_]\w*=/
const IN_PLACE_FLAG = /^-[A-Za-z]*i|^--in-place/
const DESTINATION_FLAG = /^-dest/i
const COMMAND_DIR = /^.*[/\\]/
const EXE_SUFFIX = /\.exe$/

const operands: TargetPicker = (args) => args.filter((arg) => !arg.startsWith('-'))

const lastOperand: TargetPicker = (args) => operands(args).slice(-1)

const inPlaceOperands: TargetPicker = (args) => (args.some((arg) => IN_PLACE_FLAG.test(arg)) ? operands(args) : [])

const gitTargets: TargetPicker = (args) => {
  const subcommand = operands(args)[0]
  const rest = args.slice(args.indexOf(subcommand ?? '') + 1)
  if (subcommand === 'restore') return operands(rest)
  if (subcommand !== 'checkout' || !rest.includes('--')) return []
  return rest.slice(rest.indexOf('--') + 1)
}

const copyItemTarget: TargetPicker = (args) => {
  const flag = args.findIndex((arg) => DESTINATION_FLAG.test(arg))
  return flag === -1 ? lastOperand(args) : args.slice(flag + 1, flag + 2)
}

const WRITERS: Record<string, TargetPicker> = {
  rm: operands,
  del: operands,
  truncate: operands,
  mv: operands,
  tee: operands,
  cp: lastOperand,
  sed: inPlaceOperands,
  perl: inPlaceOperands,
  git: gitTargets,
  'set-content': operands,
  'add-content': operands,
  'out-file': operands,
  'remove-item': operands,
  'move-item': operands,
  'copy-item': copyItemTarget,
}

const NULL_TARGETS = new Set(['/dev/null', '$null'])

const isProtected = createMatcher(PROTECTED_GLOBS)

const writeTargets = (words: string[]): string[] => {
  const start = words.findIndex((word) => !ASSIGNMENT.test(word))
  const name = (words[start] ?? '').replace(COMMAND_DIR, '').replace(EXE_SUFFIX, '').toLowerCase()
  const pick = Object.hasOwn(WRITERS, name) ? WRITERS[name] : undefined
  return pick === undefined ? [] : pick(words.slice(start + 1))
}

const denial = (path: string): string =>
  `${RULE}: ${path} configures the checks and is protected. Do not change it; tell the user what change you need and why.`

const pathSuffixes = (token: string): string[] => {
  const parts = toSlash(token).replace(/^\.\//, '').split('/')
  return parts.map((_, index) => parts.slice(index).join('/')).filter(Boolean)
}

export interface ShellContext {
  projectRoot: string
  cwd: string
}

const protectedSuffix = (target: string): string | undefined =>
  pathSuffixes(target).find((suffix) => isProtected(suffix))

const insideProject = (path: string): string | undefined => {
  const normalized = posix.normalize(toSlash(path))
  const isOutside = normalized === '..' || normalized.startsWith('../') || isAbsolute(normalized)
  return isOutside ? undefined : normalized.replace(/^\.\//, '')
}

const protectedInProject = (target: string, ctx: ShellContext): string | undefined => {
  const path = insideProject(toProjectPath(ctx.projectRoot, target, ctx.cwd))
  return path !== undefined && isProtected(path) ? path : undefined
}

export const checkProtectedPath = (file: string, config: JigConfig): Finding | undefined => {
  const severity = activeSeverity(config, RULE)
  const path = insideProject(file)
  if (severity === undefined || path === undefined || !isProtected(path)) return undefined
  return jigFinding(RULE, severity, { file, line: 1, message: denial(file) })
}

export const checkShellWrite = (command: string, config: JigConfig, ctx?: ShellContext): Finding | undefined => {
  const severity = activeSeverity(config, RULE)
  if (severity === undefined) return undefined
  for (const segment of splitShell(command)) {
    for (const target of [...segment.redirects, ...writeTargets(segment.words)]) {
      if (NULL_TARGETS.has(target)) continue
      const path = ctx === undefined ? protectedSuffix(target) : protectedInProject(target, ctx)
      if (path !== undefined) return jigFinding(RULE, severity, { file: path, line: 1, message: denial(path) })
    }
  }
  return undefined
}
