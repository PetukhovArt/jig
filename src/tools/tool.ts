import { extname } from 'node:path'
import { git } from '../core/git'
import type { JournalEntry } from '../core/journal'
import { run } from '../core/proc'
import type { Finding } from './finding'

export interface ToolRun {
  tool: string
  findings: Finding[]
  durationMs: number
  failure?: string
}

export interface ToolEntry {
  bin: string[]
  config?: string
}

export interface ToolWithConfig extends ToolEntry {
  config: string
}

export type ToolBin = Pick<ToolEntry, 'bin'>

export type PlanTools = Record<string, ToolEntry>

export interface ToolBinary {
  key: string
  label: string
  command: string
  packages: readonly string[]
  configs: readonly string[]
  requiresConfig: boolean
}

export type JournalNote = Omit<JournalEntry, 'session' | 'agent'>

export interface StopToolInput {
  projectRoot: string
  files: readonly string[]
  budget: (ownMs: number) => number
  lock: { path: string; transfer: (pid: number) => void }
  notes: JournalNote[]
}

export interface ToolResult {
  runs: ToolRun[]
  findings: Finding[]
}

export interface CommentDirectives {
  suppressions: readonly RegExp[]
  allowed: readonly RegExp[]
}

export interface DirectiveSource {
  name: string
  comments?: CommentDirectives
}

export interface ToolDefinition<N extends string = string> extends DirectiveSource {
  name: N
  rule: `gate/${N}`
  binaries: readonly ToolBinary[]
  edit?: (tools: PlanTools, projectRoot: string, file: string, timeoutMs: number) => Promise<ToolRun | undefined>
  stop?: (tools: PlanTools, input: StopToolInput) => Promise<ToolResult>
}

export const defineTool = <const N extends string>(definition: Omit<ToolDefinition<N>, 'rule'>): ToolDefinition<N> => ({
  ...definition,
  rule: `gate/${definition.name}`,
})

export const hasConfig = (entry: ToolEntry | undefined): entry is ToolWithConfig => entry?.config !== undefined

export const CODE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue'])

export const isCodeFile = (file: string): boolean => CODE_EXTENSIONS.has(extname(file))

export interface ToolInvocation {
  tool: string
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

export interface ExitedProcess {
  code: number | null
  output: string
  errorOutput: string
  durationMs: number
}

export const settleExit = (invocation: ToolInvocation, exited: ExitedProcess): ToolRun => {
  const { tool, okCodes, parse } = invocation
  const failed = (failure: string): ToolRun => ({ tool, findings: [], durationMs: exited.durationMs, failure })
  const isOkCode = exited.code !== null && okCodes.includes(exited.code)
  if (!isOkCode) return failed(`exit ${exited.code}: ${firstOutputLine(exited.errorOutput || exited.output)}`)
  try {
    return { tool, findings: parse(exited.output), durationMs: exited.durationMs }
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }
}

export const runTool = async (invocation: ToolInvocation): Promise<ToolRun> => {
  const { tool, argv, cwd, timeoutMs } = invocation
  const result = await run(argv, { cwd, timeoutMs })
  if (result.timedOut) return { tool, findings: [], durationMs: result.durationMs, failure: `timeout after ${timeoutMs} ms` }
  if (result.error !== undefined) return { tool, findings: [], durationMs: result.durationMs, failure: result.error }
  return settleExit(invocation, { code: result.code, output: result.stdout, errorOutput: result.stderr, durationMs: result.durationMs })
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

export const keepOnChangedLines = (projectRoot: string, findings: readonly Finding[]): Finding[] => {
  if (findings.length === 0) return []
  const lines = changedLines(projectRoot, [...new Set(findings.map((finding) => finding.file))])
  return findings.filter((finding) => isOnChangedLine(lines.get(finding.file), finding.line))
}
