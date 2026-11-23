import { parseArgs } from 'node:util'
import type { UiLocaleCheck } from '../core/config-ui'
import { EXIT_FINDINGS, EXIT_USAGE, isUsageError, projectRootOf, requireUi, UsageError, type UiContext, type UiSubcommand } from './command'
import { buildMatrix, formatMatrix } from './matrix'
import { mockup } from './mockup/mockup'
import { recordPassed } from './proof'
import { checkReuse, formatReuse } from './reuse'

export type { UiContext, UiSubcommand }

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
  if (result.findings.length > 0) return EXIT_FINDINGS
  recordPassed(root, 'ui-reuse', `jig ui reuse: no raw elements on changed lines (${result.files} component files read)`, ctx.io)
  return 0
}

export const SUBCOMMANDS = new Map<string, UiSubcommand>([
  ['matrix', matrix],
  ['reuse', reuse],
  ['mockup', mockup],
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
