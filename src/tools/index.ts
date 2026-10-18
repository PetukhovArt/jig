import { eslintTool } from './eslint'
import { oxlintTool } from './oxlint'
import { stratumTool } from './stratum'
import { tscTool } from './tsc'

export const TOOLS = [oxlintTool, tscTool, eslintTool, stratumTool] as const

export type ToolName = (typeof TOOLS)[number]['name']
export type GateRuleId = (typeof TOOLS)[number]['rule']
export type RegisteredTool = (typeof TOOLS)[number]
