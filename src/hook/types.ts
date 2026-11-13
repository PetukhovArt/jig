export type SessionSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

export interface EditPair {
  before: string
  after: string
}

export interface FileEdit {
  file: string
  edits: EditPair[]
}

export type JigEvent =
  | { kind: 'session-start'; source: SessionSource }
  | { kind: 'compact' }
  | { kind: 'prompt' }
  | ({ kind: 'pre-edit' } & FileEdit)
  | { kind: 'pre-patch'; files: FileEdit[] }
  | { kind: 'post-edit'; file: string }
  | { kind: 'post-patch'; files: string[] }
  | { kind: 'touch'; paths: string[]; read: boolean }
  | { kind: 'instructions-loaded'; file: string }
  | { kind: 'pre-shell'; callId: string }
  | { kind: 'post-shell'; callId: string; isBackground: boolean; paths?: string[] }
  | { kind: 'subagent-start'; agentId: string; agentType: string; prompt?: string }
  | { kind: 'stop'; stopHookActive: boolean }

export interface NativeRules {
  atStart: (launchDir: string) => string[]
  onRead: (file: string, launchDir: string) => string[]
}

export interface EventBase {
  sessionId: string
  agentId?: string
  projectRoot: string
  cwd: string
  attributesShell?: boolean
  native?: NativeRules
}

export type Outcome =
  | { type: 'none' }
  | { type: 'deny'; reason: string }
  | { type: 'context'; text: string }
  | { type: 'block'; reason: string }
