import type { PlanTools, ToolBinary } from '../../tools/tool'

export const PROOF_KINDS = ['behavior', 'look'] as const

export type ProofKind = (typeof PROOF_KINDS)[number]

export interface CheckDefinition<N extends string = string> {
  name: N
  binaries: readonly ToolBinary[]
  files: readonly string[]
  setup?: readonly string[]
  requires: (file: string) => readonly ProofKind[]
  proves: (command: string) => readonly ProofKind[]
  hints: Readonly<Partial<Record<ProofKind, string>>>
}

export type ProofDefinition<N extends string = string> = CheckDefinition<N>

export const defineCheck = <const N extends string>(definition: CheckDefinition<N>): CheckDefinition<N> => definition

export const isCheckActive = (check: CheckDefinition, tools: PlanTools): boolean =>
  check.binaries.every((binary) => tools[binary.key] !== undefined)
