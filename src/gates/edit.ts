import type { RuleId, Severity } from '../core/config'
import type { Plan } from '../core/plan'
import { TOOLS, type RegisteredTool } from '../tools'
import type { Finding } from '../tools/finding'
import { isCodeFile, type ToolRun } from '../tools/tool'

export { isCodeFile } from '../tools/tool'

export const EDIT_TOOL_TIMEOUT_MS = 5_000

export const ruleLevel = (plan: Plan, rule: RuleId): Severity => plan.config.rules[rule] ?? 'error'

export const applyLevel = (findings: readonly Finding[], level: Severity): Finding[] => {
  if (level === 'off') return []
  if (level === 'error') return [...findings]
  return findings.map((finding) => ({ ...finding, severity: 'warn' }))
}

const editRun = async (tool: RegisteredTool, plan: Plan, projectRoot: string, file: string): Promise<ToolRun | undefined> => {
  const level = ruleLevel(plan, tool.rule)
  if (tool.edit === undefined || level === 'off') return undefined
  const result = await tool.edit(plan.tools, projectRoot, file, EDIT_TOOL_TIMEOUT_MS)
  return result === undefined ? undefined : { ...result, findings: applyLevel(result.findings, level) }
}

export const checkEdit = async (plan: Plan, projectRoot: string, file: string): Promise<ToolRun[]> => {
  if (!isCodeFile(file)) return []
  const runs = await Promise.all(TOOLS.map((tool) => editRun(tool, plan, projectRoot, file)))
  return runs.filter((toolRun): toolRun is ToolRun => toolRun !== undefined)
}
