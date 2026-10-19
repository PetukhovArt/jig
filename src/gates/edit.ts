import { TOOLS, type RegisteredTool } from '../catalog/tools'
import { enabledSetting, type CustomCheck, type JigConfig, type Severity, type ToolSettings } from '../core/config'
import { createMatcher } from '../core/glob'
import type { Plan } from '../core/plan'
import type { Finding } from '../tools/finding'
import type { ToolRun } from '../tools/tool'
import { checkFiles, runCustomCheck } from './custom'

export const EDIT_TOOL_TIMEOUT_MS = 5_000

export const applyLevel = (findings: readonly Finding[], level: Severity): Finding[] => {
  if (level === 'off') return []
  if (level === 'error') return [...findings]
  return findings.map((finding) => ({ ...finding, severity: 'warn' }))
}

/** Level and `ignoreRules` from the tool's config entry. */
export const applySetting = (findings: readonly Finding[], setting: ToolSettings): Finding[] => {
  const isIgnored = createMatcher(setting.ignoreRules)
  return applyLevel(
    findings.filter((finding) => !isIgnored(finding.rule)),
    setting.level,
  )
}

export const toolSetting = (config: Pick<JigConfig, 'tools'>, tool: Pick<RegisteredTool, 'name'>): ToolSettings | undefined =>
  enabledSetting(config.tools, tool.name)

export const toolFiles = (tool: Pick<RegisteredTool, 'files'>, files: readonly string[]): string[] => files.filter(createMatcher(tool.files))

const editRun = async (tool: RegisteredTool, plan: Plan, projectRoot: string, file: string): Promise<ToolRun | undefined> => {
  const setting = toolSetting(plan.config, tool)
  if (tool.edit === undefined || setting === undefined || toolFiles(tool, [file]).length === 0) return undefined
  const result = await tool.edit(plan.tools, projectRoot, file, EDIT_TOOL_TIMEOUT_MS)
  return result === undefined ? undefined : { ...result, findings: applySetting(result.findings, setting) }
}

const customEditRun = (check: CustomCheck, projectRoot: string, file: string): Promise<ToolRun> | undefined => {
  if (check.on !== 'edit' || check.level === 'off' || checkFiles(check, [file]).length === 0) return undefined
  return runCustomCheck(projectRoot, check, [file], EDIT_TOOL_TIMEOUT_MS)
}

export const checkEdit = async (plan: Plan, projectRoot: string, file: string): Promise<ToolRun[]> => {
  const runs = await Promise.all([
    ...TOOLS.map((tool) => editRun(tool, plan, projectRoot, file)),
    ...plan.config.checks.map((check) => customEditRun(check, projectRoot, file)),
  ])
  return runs.filter((toolRun): toolRun is ToolRun => toolRun !== undefined)
}
