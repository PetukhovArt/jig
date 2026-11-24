import { loadConfig } from '../core/config'
import type { UiConfig } from '../core/config-ui'
import { gitToplevel } from '../core/git'
import { resolveProjectRoot } from '../core/paths'
import type { Io } from '../pre-mr/pre-mr'
import { MISSING_REFERENCES, readReferences, type References } from './references'
import type { CommandRunner } from './run'

export interface UiContext {
  cwd: string
  io: Io
  run?: CommandRunner
}

export type UiSubcommand = (args: string[], ctx: UiContext) => number
export type AsyncUiSubcommand = (args: string[], ctx: UiContext) => Promise<number>

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

export const requireReferences = (root: string): References => {
  const references = readReferences(root)
  if (references === undefined) throw new UsageError(MISSING_REFERENCES)
  return references
}
