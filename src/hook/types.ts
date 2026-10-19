export type SessionSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

export interface EditPair {
  before: string
  after: string
}

export type JigEvent =
  | { kind: 'session-start'; source: SessionSource }
  | { kind: 'prompt' }
  | { kind: 'pre-edit'; file: string; edits: EditPair[]; wholeFile?: string }
  | { kind: 'post-edit'; file: string }
  | { kind: 'post-read'; file: string }
  | { kind: 'subagent-start'; agentId: string; agentType: string }
  | { kind: 'stop'; stopHookActive: boolean }

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
