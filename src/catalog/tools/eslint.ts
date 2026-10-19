import { dirname, resolve } from 'node:path'
import { jigPaths, toProjectPath, toSlash } from '../../core/paths'
import type { Finding } from '../../tools/finding'
import { defineTool, groupByMarker, keepOnChangedLines, runTool, type ToolRun, type ToolWithConfig } from '../../tools/tool'
import { SCRIPT_FILES } from '../languages'

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

export const runEslint = (
  tool: ToolWithConfig,
  projectRoot: string,
  files: readonly string[],
  timeoutMs: number,
  cwd: string = projectRoot,
): Promise<ToolRun> =>
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
      ...files.map((file) => (cwd === projectRoot ? file : resolve(projectRoot, file))),
    ],
    cwd,
    timeoutMs,
    okCodes: OK_CODES,
    parse: (stdout) => parseEslint(stdout, projectRoot, cwd),
  })

export const eslintTool = defineTool({
  name: 'eslint',
  binaries: [{ key: 'eslint', label: 'eslint', command: 'eslint', packages: ['eslint'], configs: ESLINT_CONFIGS, requiresConfig: true }],
  files: SCRIPT_FILES,
  parse: parseEslint,
  comments: {
    suppressions: [/\beslint-disable(?:-next-line|-line)?\b/, /^\/\*\s*eslint\s+[\w@/-]+\s*:/],
    allowed: [/\beslint-enable\b/],
  },
  stop: async (tools, input) => {
    const entry = tools.eslint
    if (entry === undefined) return { runs: [], findings: [] }
    const { groups, skipped } = groupByMarker(input.projectRoot, input.files, ESLINT_CONFIGS)
    for (const file of skipped) {
      input.notes.push({ kind: 'gate-skipped', tool: 'jig', rule: 'gate/eslint', file, message: 'no eslint config above the file' })
    }
    const runs: ToolRun[] = []
    for (const group of groups) {
      const timeoutMs = input.budget(ESLINT_TIMEOUT_MS)
      if (timeoutMs === 0) break
      runs.push(await runEslint({ bin: entry.bin, config: group.marker }, input.projectRoot, group.files, timeoutMs, dirname(group.marker)))
    }
    const errors = runs.flatMap((toolRun) => toolRun.findings).filter((finding) => finding.severity === 'error')
    return { runs, findings: keepOnChangedLines(input.projectRoot, errors) }
  },
})
