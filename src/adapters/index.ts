import type { AgentAdapter } from './adapter'
import { claude } from './claude'

export type { AgentAdapter, ParsedHook } from './adapter'

export const ADAPTERS: Readonly<Record<string, AgentAdapter>> = { claude }

export const DEFAULT_AGENT = 'claude'

export const resolveAdapter = (name: string = DEFAULT_AGENT): AgentAdapter => {
  const adapter = Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : undefined
  if (adapter === undefined) throw new Error(`unknown agent ${name}, expected one of: ${Object.keys(ADAPTERS).join(', ')}`)
  return adapter
}
