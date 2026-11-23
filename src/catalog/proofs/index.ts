import { agentViewCheck } from './agent-view'

export { AGENT_VIEW_BINARY, AGENT_VIEW_CONFIG, agentViewCheck, MARKUP_FILES, STYLE_FILES } from './agent-view'
export {
  AGENT_PROOF_KINDS,
  defineCheck,
  isCheckActive,
  isUiProofKind,
  PROOF_KINDS,
  UI_PROOF_KINDS,
  type AgentProofKind,
  type CheckDefinition,
  type ProofDefinition,
  type ProofKind,
  type UiProofKind,
} from './proof'

export const PROOFS = [agentViewCheck] as const

export type ProofName = (typeof PROOFS)[number]['name']
