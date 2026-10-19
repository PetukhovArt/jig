export type SessionSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

export interface EditPair {
  before: string
  after: string
}

export type JigEvent =
  | { kind: 'session-start'; source: SessionSource }
  | { kind: 'prompt'; command?: string }
  | { kind: 'pre-edit'; file: string; edits: EditPair[]; wholeFile?: string }
  | { kind: 'post-edit'; file: string }
  | { kind: 'subagent-start'; agentId: string; agentType: string; prompt?: string }
  | { kind: 'stop'; stopHookActive: boolean; todos?: readonly TodoItem[] }

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  text: string
  status: TodoStatus
}

export interface EventBase {
  sessionId: string
  agentId?: string
  projectRoot: string
  cwd: string
}

export type Outcome =
  | { type: 'none' }
  | { type: 'deny'; reason: string }
  | { type: 'context'; text: string }
  | { type: 'block'; reason: string }
