import { resolve } from 'node:path'
import type { ToolWithConfig } from '../core/plan'
import { jigPaths, toProjectPath, toSlash } from '../core/paths'
import type { Finding } from './finding'
import { runTool, type ToolRun } from './tool'

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

export const ESLINT_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue'])

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
