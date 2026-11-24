import type { JigConfig } from '../core/config'
import type { JournalRecord } from '../core/journal'
import { readReferences } from '../ui/references'
import { buildMatrix } from '../ui/matrix'

export const UI_PROOF_KINDS = ['ui-scope', 'ui-reference', 'ui-reuse', 'ui-mockup', 'ui-matrix'] as const
export type UiProofKind = (typeof UI_PROOF_KINDS)[number]

export const UI_SCOPES = ['ui', 'none'] as const
export type UiScope = (typeof UI_SCOPES)[number]

export const SCOPE_HINT = 'jig ui scope ui|none "<why>"'
export const MATRIX_APP_HINT = 'jig ui prove, with ui.driver set in .jig/config.local.jsonc, or jig ui prove --collect after capturing every combination yourself'
const MINUTES_PER_TARGET = 5

export interface UiRequirement {
  rule: string
  hint: string
  declaration: boolean
}

export const mockupRule = (n: number): string => `ui-mockup:${n}`

export const scopeMessage = (value: UiScope, why: string): string => `${value}: ${why}`

export const scopeOf = (record: JournalRecord): { value: UiScope; reason: string } | undefined => {
  const found = /^(ui|none): ([\s\S]*)$/.exec(record.message ?? '')
  return found === null ? undefined : { value: found[1] as UiScope, reason: found[2] ?? '' }
}

export const uiRequirements = (root: string, config: JigConfig): UiRequirement[] => {
  const ui = config.ui
  if (ui === undefined) return []
  const needed: UiRequirement[] = [{ rule: 'ui-reference', hint: 'jig ui reference add "<source>" or jig ui reference none "<reason>"', declaration: true }]
  if (Object.keys(ui.components?.map ?? {}).length > 0) needed.push({ rule: 'ui-reuse', hint: 'jig ui reuse', declaration: false })
  for (const entry of readReferences(root)?.entries ?? []) {
    if (entry.tree !== undefined) needed.push({ rule: mockupRule(entry.n), hint: `jig ui mockup ${entry.n}`, declaration: false })
  }
  if (buildMatrix(ui).combos.length > 0) {
    needed.push({ rule: 'ui-matrix', hint: ui.driver === undefined ? MATRIX_APP_HINT : 'jig ui prove', declaration: false })
  }
  return needed
}

export const breakItMinutes = (config: JigConfig): number => Math.max(MINUTES_PER_TARGET, (config.ui?.targets.length ?? 0) * MINUTES_PER_TARGET)
