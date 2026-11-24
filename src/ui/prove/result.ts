import type { Combo, ManualTarget } from '../matrix'

export interface AuditTarget {
  testid?: string
  role?: string
  name?: string
  text?: string
  selector: string
}

export interface AuditFinding {
  rule: string
  severity: 'error' | 'warn'
  target: AuditTarget
  rect: { x: number; y: number; width: number; height: number }
  detail: string
}

export interface AuditOutcome {
  kind: 'layout' | 'scene'
  errors: number
  warnings: number
  scanned?: number
  findings: AuditFinding[]
  shot?: string
  note?: string
}

export interface ReferenceDiff {
  n: number
  reference: string
  map: string
  differing: number
  total: number
  ratio: number
  sizeMismatch: boolean
}

export interface StateResult {
  state: string
  failure?: string
  shot?: string
  audits: AuditOutcome[]
  diffs: ReferenceDiff[]
  referenceNotes: string[]
}

export interface ComboResult {
  id: string
  combo: Combo
  tree: string
  scaleFactor?: number
  failure?: string
  states: StateResult[]
}

export interface SkippedCombo {
  id: string
  combo: Combo
  why: string
}

export interface ProveResult {
  branch: string
  generatedAt: string
  tree: string
  reference?: string
  root?: string
  combos: ComboResult[]
  skipped: SkippedCombo[]
  manual: ManualTarget[]
  notes: string[]
}

export const auditErrors = (combo: ComboResult): number =>
  combo.states.reduce((sum, state) => sum + state.audits.reduce((inner, audit) => inner + audit.errors, 0), 0)

export const failuresOf = (combo: ComboResult): string[] => [
  ...(combo.failure === undefined ? [] : [combo.failure]),
  ...combo.states.flatMap((state) => (state.failure === undefined ? [] : [`${state.state}: ${state.failure}`])),
]
