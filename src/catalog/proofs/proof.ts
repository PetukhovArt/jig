import type { PlanTools, ToolBinary } from '../../tools/tool'
import type { SourceReader } from '../languages'

export const AGENT_PROOF_KINDS = ['behavior', 'look'] as const
export const UI_PROOF_KINDS = ['ui-reuse', 'ui-mockup', 'ui-matrix'] as const
export const PROOF_KINDS = [...AGENT_PROOF_KINDS, ...UI_PROOF_KINDS] as const

export type AgentProofKind = (typeof AGENT_PROOF_KINDS)[number]
export type UiProofKind = (typeof UI_PROOF_KINDS)[number]
export type ProofKind = (typeof PROOF_KINDS)[number]

export const isUiProofKind = (kind: ProofKind): kind is UiProofKind => UI_PROOF_KINDS.some((own) => own === kind)

export interface CheckDefinition<N extends string = string> {
  name: N
  binaries: readonly ToolBinary[]
  files: readonly string[]
  setup?: readonly string[]
  requires: (file: string, source?: SourceReader) => readonly AgentProofKind[]
  proves: (command: string) => readonly AgentProofKind[]
  hints: Readonly<Partial<Record<AgentProofKind, string>>>
}

export type ProofDefinition<N extends string = string> = CheckDefinition<N>

export const defineCheck = <const N extends string>(definition: CheckDefinition<N>): CheckDefinition<N> => definition

export const isCheckActive = (check: CheckDefinition, tools: PlanTools): boolean =>
  check.binaries.every((binary) => tools[binary.key] !== undefined)
