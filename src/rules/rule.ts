import type { JigConfig, RuleId } from '../core/config'
import type { Finding } from '../tools/finding'

export interface Edit {
  before: string
  after: string
  line?: number
}

export const fileLine = (edit: Edit, fragmentLine: number): number => fragmentLine + (edit.line ?? 1) - 1

export interface RuleHit {
  file: string
  line: number
  message: string
}

export const activeSeverity = (config: JigConfig, rule: RuleId): Finding['severity'] | undefined => {
  const severity = config.rules[rule]
  return severity === 'off' ? undefined : severity
}

export const jigFinding = (rule: RuleId, severity: Finding['severity'], hit: RuleHit): Finding => ({
  tool: 'jig',
  rule,
  severity,
  ...hit,
})
