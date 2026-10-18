import { resolve } from 'node:path'
import { jigPaths, toProjectPath, toSlash } from '../core/paths'
import type { Finding } from './finding'
import { defineTool, hasConfig, isCodeFile, keepOnChangedLines, runTool, type ToolRun, type ToolWithConfig } from './tool'

interface EslintMessage {
  ruleId?: string | null
  severity?: number
  line?: number
  message?: string
}

interface EslintFileResult {
  filePath?: string
  messages?: EslintMessage[]
}

export const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
] as const

export const ESLINT_TIMEOUT_MS = 30_000

const OK_CODES = [0, 1]
const ERROR_SEVERITY = 2

export const parseEslint = (stdout: string, projectRoot: string, cwd: string = projectRoot): Finding[] => {
  if (stdout.trim() === '') return []
  const results = JSON.parse(stdout) as EslintFileResult[]
  return results.flatMap((result) => {
    const file = toProjectPath(projectRoot, resolve(cwd, result.filePath ?? ''))
    return (result.messages ?? []).map((message): Finding => ({
      tool: 'eslint',
      rule: message.ruleId ?? 'eslint',
      severity: message.severity === ERROR_SEVERITY ? 'error' : 'warn',
      file,
      line: message.line ?? 1,
      message: message.message ?? '',
    }))
  })
}

export const runEslint = (tool: ToolWithConfig, projectRoot: string, files: readonly string[], timeoutMs: number): Promise<ToolRun> =>
  runTool({
    tool: 'eslint',
    argv: [
      ...tool.bin,
      '--format',
      'json',
      '--cache',
      '--cache-location',
      `${toSlash(jigPaths(projectRoot).eslintCache)}/`,
      '--no-warn-ignored',
      ...files,
    ],
    cwd: projectRoot,
    timeoutMs,
    okCodes: OK_CODES,
    parse: (stdout) => parseEslint(stdout, projectRoot),
  })

export const eslintTool = defineTool({
  name: 'eslint',
  binaries: [{ key: 'eslint', label: 'eslint', command: 'eslint', packages: ['eslint'], configs: ESLINT_CONFIGS, requiresConfig: true }],
  stop: async (tools, input) => {
    const files = input.files.filter(isCodeFile)
    const timeoutMs = input.budget(ESLINT_TIMEOUT_MS)
    const entry = tools.eslint
    const isSkipped = files.length === 0 || timeoutMs === 0
    if (isSkipped || !hasConfig(entry)) return { runs: [], findings: [] }
    const toolRun = await runEslint(entry, input.projectRoot, files, timeoutMs)
    const errors = toolRun.findings.filter((finding) => finding.severity === 'error')
    return { runs: [toolRun], findings: keepOnChangedLines(input.projectRoot, errors) }
  },
})
