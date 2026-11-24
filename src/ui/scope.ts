import { parseArgs } from 'node:util'
import { SCOPE_HINT, scopeMessage, UI_SCOPES, type UiScope } from '../pre-mr/ui-requirements'
import { projectRootOf, UsageError, type UiSubcommand } from './command'
import { recordPassed } from './proof'

const SCOPE_USAGE = `usage: ${SCOPE_HINT}`

const isScope = (value: string | undefined): value is UiScope => UI_SCOPES.some((scope) => scope === value)

export const scope: UiSubcommand = (args, ctx) => {
  const { positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {} })
  const [value, ...rest] = positionals
  const why = rest.join(' ').trim()
  if (!isScope(value) || why === '') throw new UsageError(SCOPE_USAGE)
  return recordPassed(projectRootOf(ctx.cwd), 'ui-scope', scopeMessage(value, why), ctx.io) ? 0 : 1
}
