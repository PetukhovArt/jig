import { EXIT_FORMAT, outputParser } from '../catalog'
import { expandToken, splitCommand } from '../core/command'
import type { CustomCheck, Severity } from '../core/config'
import { createMatcher } from '../core/glob'
import { resolveBin, run } from '../core/proc'
import type { Finding } from '../tools/finding'
import { keepOnChangedLines, settleExit, type ToolRun } from '../tools/tool'

const FILES_TOKEN = '{files}'
const PARSED_OK_CODES = [0, 1]
const MESSAGE_MAX = 200

export const checkRule = (check: Pick<CustomCheck, 'name'>): `check/${string}` => `check/${check.name}`

export const checkFiles = (check: Pick<CustomCheck, 'files'>, files: readonly string[]): string[] => {
  const matches = createMatcher(check.files)
  return files.filter(matches)
}

export const checkArgv = (projectRoot: string, check: Pick<CustomCheck, 'run'>, files: readonly string[]): string[] => {
  const [command = '', ...args] = expandToken(splitCommand(check.run), FILES_TOKEN, files)
  return [...(resolveBin(projectRoot, [], command) ?? [command]), ...args]
}

const firstLine = (text: string): string => text.split('\n').map((line) => line.trim()).find((line) => line !== '')?.slice(0, MESSAGE_MAX) ?? ''

const exitFinding = (check: CustomCheck, file: string, output: string, code: number | null): Finding => ({
  tool: check.name,
  rule: checkRule(check),
  severity: 'error',
  file,
  line: 1,
  message: firstLine(output) || `exit ${code}`,
})

const withSeverity = (findings: readonly Finding[], level: Severity): Finding[] => {
  if (level === 'off') return []
  return findings.map((finding) => ({ ...finding, severity: level === 'warn' ? 'warn' : finding.severity }))
}

/** Runs a project check from config on `files`; `{files}` in `run` expands to one argument per file. */
export const runCustomCheck = async (projectRoot: string, check: CustomCheck, files: readonly string[], timeoutMs: number): Promise<ToolRun> => {
  const argv = checkArgv(projectRoot, check, files)
  const result = await run(argv, { cwd: projectRoot, timeoutMs })
  const tool = check.name
  if (result.timedOut) return { tool, findings: [], durationMs: result.durationMs, failure: `timeout after ${timeoutMs} ms` }
  if (result.error !== undefined) return { tool, findings: [], durationMs: result.durationMs, failure: result.error }
  const parse = outputParser(check.format)
  if (check.format === EXIT_FORMAT || parse === undefined) {
    const isClean = result.code === 0
    const [file = ''] = files
    const findings = isClean ? [] : [exitFinding(check, file, result.stderr || result.stdout, result.code)]
    return { tool, findings: withSeverity(findings, check.level), durationMs: result.durationMs }
  }
  const settled = settleExit(
    { tool, argv, cwd: projectRoot, timeoutMs, okCodes: PARSED_OK_CODES, parse: (stdout) => parse(stdout, projectRoot, projectRoot) },
    { code: result.code, output: result.stdout, errorOutput: result.stderr, durationMs: result.durationMs },
  )
  const findings = keepOnChangedLines(projectRoot, settled.findings).filter((finding) => finding.severity === 'error')
  return { ...settled, findings: withSeverity(findings, check.level) }
}
