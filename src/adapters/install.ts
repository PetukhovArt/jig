import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolvePluginRoot, toSlash } from '../core/paths'

type Command = (args: string[]) => number

interface HookSpec {
  event: string
  matcher?: string
  hook: string
  timeout: number
}

const CODEX_HOOKS: readonly HookSpec[] = [
  { event: 'SessionStart', hook: 'session-start', timeout: 15 },
  { event: 'UserPromptSubmit', hook: 'user-prompt-submit', timeout: 10 },
  { event: 'PreToolUse', matcher: 'apply_patch|Edit|Write', hook: 'pre-edit', timeout: 10 },
  { event: 'PreToolUse', matcher: 'Bash', hook: 'pre-shell', timeout: 10 },
  { event: 'PostToolUse', matcher: 'apply_patch|Edit|Write', hook: 'post-edit', timeout: 30 },
  { event: 'PostToolUse', matcher: 'Bash', hook: 'post-shell', timeout: 10 },
  { event: 'PostCompact', hook: 'compact', timeout: 10 },
  { event: 'SubagentStart', hook: 'subagent-start', timeout: 10 },
  { event: 'Stop', hook: 'stop', timeout: 120 },
]

const MARKER = '_jigManaged'
const USAGE = 'usage: jig hooks codex [--install | --uninstall]'

type Entry = Record<string, unknown>
type HooksFile = { hooks?: Record<string, Entry[]> } & Record<string, unknown>

const codexHome = (): string => process.env['CODEX_HOME'] ?? join(homedir(), '.codex')

const commandFor = (pluginRoot: string, hook: string): string => `node "${toSlash(join(pluginRoot, 'bin', 'jig.mjs'))}" hook ${hook} --agent codex`

const entriesFor = (pluginRoot: string): Record<string, Entry[]> => {
  const byEvent: Record<string, Entry[]> = {}
  for (const spec of CODEX_HOOKS) {
    const entry: Entry = {
      [MARKER]: true,
      ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
      hooks: [{ type: 'command', command: commandFor(pluginRoot, spec.hook), timeout: spec.timeout }],
    }
    byEvent[spec.event] = [...(byEvent[spec.event] ?? []), entry]
  }
  return byEvent
}

const readHooks = (path: string): HooksFile => {
  if (!existsSync(path)) return {}
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} is not a JSON object`)
  return value as HooksFile
}

const withoutJig = (hooks: Record<string, Entry[]>): Record<string, Entry[]> =>
  Object.fromEntries(
    Object.entries(hooks)
      .map(([event, entries]) => [event, entries.filter((entry) => entry[MARKER] !== true)] as const)
      .filter(([, entries]) => entries.length > 0),
  )

export const runHooks: Command = (args) => {
  const [agent, action] = args
  if (agent !== 'codex') throw new Error(USAGE)
  const entries = entriesFor(resolvePluginRoot())
  if (action === undefined) {
    process.stdout.write(`${JSON.stringify({ hooks: entries }, null, 2)}\n`)
    return 0
  }
  if (action !== '--install' && action !== '--uninstall') throw new Error(USAGE)
  const path = join(codexHome(), 'hooks.json')
  const file = readHooks(path)
  const kept = withoutJig(file.hooks ?? {})
  const hooks = action === '--uninstall' ? kept : Object.fromEntries([...new Set([...Object.keys(kept), ...Object.keys(entries)])].map((event) => [event, [...(kept[event] ?? []), ...(entries[event] ?? [])]]))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...file, hooks }, null, 2)}\n`)
  process.stdout.write(`${action === '--install' ? 'installed jig hooks in' : 'removed jig hooks from'} ${toSlash(path)}\n`)
  return 0
}
