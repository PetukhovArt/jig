import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { toProjectPath } from '../core/paths'
import type { Finding } from './finding'
import { changedLines, defineTool, hasConfig, isOnChangedLine, runTool, type ToolRun, type ToolWithConfig } from './tool'

interface OxlintSpan {
  offset?: number
  line?: number
}

interface OxlintDiagnostic {
  message?: string
  code?: string
  ruleId?: string
  severity?: string
  filename?: string
  labels?: { span?: OxlintSpan }[]
}

export const OXLINT_CONFIGS = ['.oxlintrc.json', 'oxlint.json', 'oxlintrc.json'] as const

const OK_CODES = [0, 1]

const lineAtOffset = (path: string, offset: number): number => {
  try {
    return readFileSync(path, 'utf8').slice(0, offset).split('\n').length
  } catch {
    return 1
  }
}

const startLine = (diagnostic: OxlintDiagnostic, absolutePath: string): number => {
  const span = diagnostic.labels?.[0]?.span
  if (span?.line !== undefined) return span.line
  if (span?.offset !== undefined) return lineAtOffset(absolutePath, span.offset)
  return 1
}

const diagnosticsOf = (stdout: string): OxlintDiagnostic[] => {
  if (stdout.trim() === '') return []
  const value: unknown = JSON.parse(stdout)
  if (Array.isArray(value)) return value as OxlintDiagnostic[]
  const diagnostics = (value as { diagnostics?: unknown }).diagnostics
  return Array.isArray(diagnostics) ? (diagnostics as OxlintDiagnostic[]) : []
}

export const parseOxlint = (stdout: string, projectRoot: string, cwd: string = projectRoot): Finding[] =>
  diagnosticsOf(stdout).map((diagnostic) => {
    const absolutePath = resolve(cwd, diagnostic.filename ?? '')
    return {
      tool: 'oxlint',
      rule: diagnostic.ruleId ?? diagnostic.code ?? 'oxlint',
      severity: diagnostic.severity === 'error' ? 'error' : 'warn',
      file: toProjectPath(projectRoot, absolutePath),
      line: startLine(diagnostic, absolutePath),
      message: diagnostic.message ?? '',
    }
  })

export const runOxlint = (tool: ToolWithConfig, projectRoot: string, file: string, timeoutMs: number): Promise<ToolRun> =>
  runTool({
    tool: 'oxlint',
    argv: [...tool.bin, '--format', 'json', '-c', tool.config, file],
    cwd: projectRoot,
    timeoutMs,
    okCodes: OK_CODES,
    parse: (stdout) => parseOxlint(stdout, projectRoot),
  })

export const oxlintTool = defineTool({
  name: 'oxlint',
  binaries: [{ key: 'oxlint', label: 'oxlint', command: 'oxlint', packages: ['oxlint'], configs: OXLINT_CONFIGS, requiresConfig: true }],
  edit: async (tools, projectRoot, file, timeoutMs) => {
    const entry = tools.oxlint
    if (!hasConfig(entry)) return undefined
    const result = await runOxlint(entry, projectRoot, file, timeoutMs)
    const errors = result.findings.filter((finding) => finding.severity === 'error')
    if (errors.length === 0) return { ...result, findings: [] }
    const lines = changedLines(projectRoot, [file]).get(file)
    return { ...result, findings: errors.filter((finding) => isOnChangedLine(lines, finding.line)) }
  },
})
