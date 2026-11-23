import type { UiProofKind } from '../catalog/proofs/proof'
import { recordUiProof, type Io } from '../pre-mr/pre-mr'

export const recordPassed = (root: string, kind: UiProofKind, message: string, io: Io): void => {
  try {
    const entry = recordUiProof(root, kind, message)
    io.out(`jig: recorded ${kind} proof at ${entry.ts}\n`)
  } catch (error) {
    io.err(`jig: ${kind} proof not recorded: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
