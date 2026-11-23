import { fileSource, isTestFile } from '../catalog/languages'
import { isUiFile } from '../catalog/proofs/agent-view'
import type { UiProofKind } from '../catalog/proofs/proof'
import type { JigConfig } from '../core/config'
import { createMatcher } from '../core/glob'
import { declaredReference, declaresFigma } from '../ui/dir'
import { buildMatrix } from '../ui/matrix'

export interface UiRequirement {
  kind: UiProofKind
  files: string[]
  hint: string
}

export const uiRequirements = (root: string, files: readonly string[], config: JigConfig, isAgentViewConfigured: boolean): UiRequirement[] => {
  const ui = config.ui
  if (ui === undefined) return []
  const isComponent = createMatcher(ui.components?.files ?? [])
  const uiFiles = files.filter((file) => (isUiFile(file) || isComponent(file)) && !isTestFile(file, fileSource(root, file)))
  if (uiFiles.length === 0) return []
  const needed: UiRequirement[] = []
  if (Object.keys(ui.components?.map ?? {}).length > 0) needed.push({ kind: 'ui-reuse', files: uiFiles, hint: 'jig ui reuse' })
  if (isAgentViewConfigured && buildMatrix(ui).combos.length > 0) needed.push({ kind: 'ui-matrix', files: uiFiles, hint: 'jig ui prove' })
  const reference = declaredReference(root)
  if (declaresFigma(reference)) {
    const url = (reference ?? '').slice('figma:'.length)
    needed.push({ kind: 'ui-mockup', files: uiFiles, hint: `jig ui mockup --figma ${url} --component <node id>` })
  }
  return needed
}
