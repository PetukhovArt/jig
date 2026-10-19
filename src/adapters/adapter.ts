import type { EventBase, JigEvent, Outcome, TodoItem } from '../hook/types'

export interface ParsedHook {
  event: JigEvent
  base: EventBase
}

export interface AgentAdapter {
  name: string
  parseHookInput: (name: string, raw: string, env?: NodeJS.ProcessEnv) => ParsedHook | undefined
  formatOutcome: (kind: JigEvent['kind'], outcome: Outcome) => string
  readTodos?: (raw: string, env?: NodeJS.ProcessEnv) => readonly TodoItem[] | undefined
}
