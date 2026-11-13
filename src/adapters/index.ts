import type { AgentAdapter } from './adapter'
import { claude, codex, grok, opencode } from './claude'

export type { AgentAdapter, ParsedHook } from './adapter'

export const ADAPTERS: Readonly<Record<string, AgentAdapter>> = { claude, codex, grok, opencode }

export const DEFAULT_AGENT = 'claude'

const DETECT: readonly { agent: string; vars: readonly string[] }[] = [
  { agent: 'grok', vars: ['GROK_HOOK_EVENT', 'GROK_SESSION_ID'] },
  { agent: 'claude', vars: ['CLAUDE_PROJECT_DIR'] },
  { agent: 'codex', vars: ['CODEX_THREAD_ID'] },
  { agent: 'opencode', vars: ['OPENCODE'] },
]

export const detectAgent = (env: NodeJS.ProcessEnv = process.env): string =>
  DETECT.find(({ vars }) => vars.some((name) => env[name] !== undefined && env[name] !== ''))?.agent ?? DEFAULT_AGENT

export const resolveAdapter = (name: string = detectAgent()): AgentAdapter => {
  const adapter = Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : undefined
  if (adapter === undefined) throw new Error(`unknown agent ${name}, expected one of: ${Object.keys(ADAPTERS).join(', ')}`)
  return adapter
}
