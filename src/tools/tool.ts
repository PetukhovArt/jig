import { git } from '../core/git'
import { run } from '../core/proc'
import type { Finding } from './finding'

export type ToolName = Exclude<Finding['tool'], 'jig'>

export interface ToolRun {
  tool: ToolName
  findings: Finding[]
  durationMs: number
  failure?: string
}

export interface ToolInvocation {
  tool: ToolName
  argv: string[]
  cwd: string
  timeoutMs: number
  okCodes: readonly number[]
  parse: (stdout: string) => Finding[]
}

export type ChangedLines = ReadonlySet<number> | 'all'

const FAILURE_DETAIL_MAX = 200
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

const firstOutputLine = (text: string): string => text.trim().split('\n')[0]?.slice(0, FAILURE_DETAIL_MAX) ?? ''

export const runTool = async (invocation: ToolInvocation): Promise<ToolRun> => {
  const { tool, argv, cwd, timeoutMs, okCodes, parse } = invocation
  const result = await run(argv, { cwd, timeoutMs })
  const failed = (failure: string): ToolRun => ({ tool, findings: [], durationMs: result.durationMs, failure })
  if (result.timedOut) return failed(`timeout after ${timeoutMs} ms`)
  if (result.error !== undefined) return failed(result.error)
  const isOkCode = result.code !== null && okCodes.includes(result.code)
  if (!isOkCode) return failed(`exit ${result.code}: ${firstOutputLine(result.stderr || result.stdout)}`)
  try {
    return { tool, findings: parse(result.stdout), durationMs: result.durationMs }
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }
}

const parseDiffLines = (diff: string): Map<string, Set<number>> => {
  const lines = new Map<string, Set<number>>()
  let current: Set<number> | undefined
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trimEnd()
      current = path === '/dev/null' ? undefined : new Set()
      if (current !== undefined) {
        lines.set(path, current)
      }
      continue
    }
    const hunk = HUNK_HEADER.exec(line)
    if (hunk === null || current === undefined) continue
    const start = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    for (let at = start; at < start + count; at++) {
      current.add(at)
    }
  }
  return lines
}

export const changedLines = (projectRoot: string, files: readonly string[]): Map<string, ChangedLines> => {
  const result = new Map<string, ChangedLines>()
  if (files.length === 0) return result
  const listed = git(['ls-files', '-z', '--', ...files], projectRoot)
  const tracked = new Set(listed.ok ? listed.stdout.split('\0').filter(Boolean) : [])
  const diff = git(
    ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--unified=0', '--relative', '--no-prefix', 'HEAD', '--', ...files],
    projectRoot,
  )
  const diffLines = diff.ok ? parseDiffLines(diff.stdout) : new Map<string, Set<number>>()
  for (const file of files) {
    const isWholeFile = !diff.ok || !tracked.has(file)
    result.set(file, isWholeFile ? 'all' : (diffLines.get(file) ?? new Set()))
  }
  return result
}

export const isOnChangedLine = (lines: ChangedLines | undefined, line: number): boolean =>
  lines === 'all' || lines?.has(line) === true
