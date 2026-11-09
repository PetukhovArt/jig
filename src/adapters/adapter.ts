import type { EventBase, JigEvent, NativeRules, Outcome } from '../hook/types'

export interface ParsedHook {
  event: JigEvent
  base: EventBase
}

export interface AgentAdapter {
  name: string
  attributesShell: boolean
  native: NativeRules
  parseHookInput: (name: string, raw: string, env?: NodeJS.ProcessEnv) => ParsedHook | undefined
  formatOutcome: (kind: JigEvent['kind'], outcome: Outcome) => string
}
