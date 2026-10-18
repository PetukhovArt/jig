import { extname } from 'node:path'
import type { RuleId, Severity } from '../core/config'
import type { Plan } from '../core/plan'
import { ESLINT_EXTENSIONS } from '../tools/eslint'
import type { Finding } from '../tools/finding'
import { runOxlint } from '../tools/oxlint'
import { runStratum } from '../tools/stratum'
import { changedLines, isOnChangedLine, type ToolRun } from '../tools/tool'

export const EDIT_TOOL_TIMEOUT_MS = 5_000

export const isCodeFile = (file: string): boolean => ESLINT_EXTENSIONS.has(extname(file))

export const ruleLevel = (plan: Plan, rule: RuleId): Severity => plan.config.rules[rule] ?? 'error'

export const applyLevel = (findings: readonly Finding[], level: Severity): Finding[] => {
  if (level === 'off') return []
  if (level === 'error') return [...findings]
  return findings.map((finding) => ({ ...finding, severity: 'warn' }))
}

const withFindings = (toolRun: ToolRun, findings: Finding[]): ToolRun => ({ ...toolRun, findings })

const oxlintRun = async (plan: Plan, projectRoot: string, file: string): Promise<ToolRun | undefined> => {
  const level = ruleLevel(plan, 'gate/oxlint')
  if (plan.tools.oxlint === undefined || level === 'off') return undefined
  const result = await runOxlint(plan.tools.oxlint, projectRoot, file, EDIT_TOOL_TIMEOUT_MS)
  const errors = result.findings.filter((finding) => finding.severity === 'error')
  if (errors.length === 0) return withFindings(result, [])
  const lines = changedLines(projectRoot, [file]).get(file)
  return withFindings(result, applyLevel(errors.filter((finding) => isOnChangedLine(lines, finding.line)), level))
}

const stratumRun = async (plan: Plan, projectRoot: string, file: string): Promise<ToolRun | undefined> => {
  const level = ruleLevel(plan, 'gate/stratum')
  if (plan.tools.stratum === undefined || level === 'off') return undefined
  const result = await runStratum(plan.tools.stratum, projectRoot, [file], EDIT_TOOL_TIMEOUT_MS)
  return withFindings(result, applyLevel(result.findings, level))
}

export const checkEdit = async (plan: Plan, projectRoot: string, file: string): Promise<ToolRun[]> => {
  if (!isCodeFile(file)) return []
  const runs = await Promise.all([oxlintRun(plan, projectRoot, file), stratumRun(plan, projectRoot, file)])
  return runs.filter((toolRun): toolRun is ToolRun => toolRun !== undefined)
}
