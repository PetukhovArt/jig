import { parseArgs } from 'node:util'
import { loadConfig } from '../core/config'
import type { UiConfig, UiLocaleCheck } from '../core/config-ui'
import { gitToplevel } from '../core/git'
import { resolveProjectRoot } from '../core/paths'
import type { Io } from '../pre-mr/pre-mr'
import { buildMatrix, formatMatrix } from './matrix'
import { checkReuse, formatReuse } from './reuse'

export interface UiContext {
  cwd: string
  io: Io
}

export type UiSubcommand = (args: string[], ctx: UiContext) => number

export const EXIT_FINDINGS = 1
export const EXIT_USAGE = 2

export class UsageError extends Error {}

export const isUsageError = (error: unknown): error is Error =>
  error instanceof UsageError ||
  (error instanceof TypeError && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS'))

export const projectRootOf = (cwd: string): string => gitToplevel(cwd) ?? resolveProjectRoot(cwd)

export const requireUi = (root: string): UiConfig => {
  const config = loadConfig(root)
  if (config.error !== undefined) throw new Error(`config: ${config.error}`)
  if (config.ui === undefined) throw new Error('no "ui" section in .jig/config.jsonc: run jig init and add the proposed ui key, or write one (docs/configuration.md)')
  return config.ui
}

const MATRIX_USAGE = 'usage: jig ui matrix [--locales one|all] [--json]'

const isLocaleCheck = (value: string | undefined): value is UiLocaleCheck | undefined => value === undefined || value === 'one' || value === 'all'

const matrix: UiSubcommand = (args, ctx) => {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { json: { type: 'boolean' }, locales: { type: 'string' } } })
  if (positionals.length > 0 || !isLocaleCheck(values.locales)) throw new UsageError(MATRIX_USAGE)
  const result = buildMatrix(requireUi(projectRootOf(ctx.cwd)), values.locales)
  ctx.io.out(values.json === true ? `${JSON.stringify(result, null, 2)}\n` : `${formatMatrix(result).join('\n')}\n`)
  return 0
}

const REUSE_USAGE = 'usage: jig ui reuse [--base <ref>] [--json]'

const reuse: UiSubcommand = (args, ctx) => {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { json: { type: 'boolean' }, base: { type: 'string' } } })
  if (positionals.length > 0) throw new UsageError(REUSE_USAGE)
  const root = projectRootOf(ctx.cwd)
  const components = requireUi(root).components
  if (components === undefined || Object.keys(components.map).length === 0) {
    throw new Error('ui.components.map is empty: name the raw elements and the component to use for each (docs/configuration.md#ui-profile)')
  }
  const result = checkReuse(root, components, values.base)
  ctx.io.out(values.json === true ? `${JSON.stringify(result, null, 2)}\n` : `${formatReuse(result).join('\n')}\n`)
  return result.findings.length > 0 ? EXIT_FINDINGS : 0
}

export const SUBCOMMANDS = new Map<string, UiSubcommand>([
  ['matrix', matrix],
  ['reuse', reuse],
])

export const ui = (args: string[], ctx: UiContext): number => {
  const [name, ...rest] = args
  const subcommand = name === undefined ? undefined : SUBCOMMANDS.get(name)
  if (subcommand === undefined) {
    ctx.io.err(`jig: usage: jig ui ${[...SUBCOMMANDS.keys()].join('|')} ...\n`)
    return EXIT_USAGE
  }
  try {
    return subcommand(rest, ctx)
  } catch (error) {
    if (!isUsageError(error)) throw error
    ctx.io.err(`jig: ${error.message}\n`)
    return EXIT_USAGE
  }
}

export const runUi = (args: string[]): number =>
  ui(args, { cwd: process.cwd(), io: { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) } })
