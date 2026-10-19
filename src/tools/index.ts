import { DIRECTIVE_ONLY_TOOLS } from './directives'
import { eslintTool } from './eslint'
import { oxlintTool } from './oxlint'
import { stratumTool } from './stratum'
import type { DirectiveSource } from './tool'
import { tscTool } from './tsc'

export const TOOLS = [oxlintTool, tscTool, eslintTool, stratumTool] as const

export const DIRECTIVE_SOURCES: readonly DirectiveSource[] = [...TOOLS, ...DIRECTIVE_ONLY_TOOLS]

export type ToolName = (typeof TOOLS)[number]['name']
export type GateRuleId = (typeof TOOLS)[number]['rule']
export type RegisteredTool = (typeof TOOLS)[number]
