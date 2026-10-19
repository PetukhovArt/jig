import { agentViewCheck } from './agent-view'

export { AGENT_VIEW_BINARY, AGENT_VIEW_CONFIG, agentViewCheck, MARKUP_FILES, STYLE_FILES } from './agent-view'
export { defineCheck, isCheckActive, PROOF_KINDS, type CheckDefinition, type ProofDefinition, type ProofKind } from './proof'

export const PROOFS = [agentViewCheck] as const

export type ProofName = (typeof PROOFS)[number]['name']
