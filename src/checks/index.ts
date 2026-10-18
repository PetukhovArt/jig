import { agentViewCheck } from './agent-view'

export { defineCheck, isCheckActive, PROOF_KINDS, type CheckDefinition, type ProofKind } from './check'

export const CHECKS = [agentViewCheck] as const

