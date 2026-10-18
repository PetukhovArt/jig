import type { ToolWithConfig } from '../core/plan'
import type { Finding } from './finding'
import { runTool, type ToolRun } from './tool'

interface StratumRecord {
  v?: number
  rule?: string
  severity?: string
  file?: string
  line?: number
  message?: string
  fix?: string
}

const CONTRACT_VERSION = 1
const OK_CODES = [0, 1, 3]
const SEVERITIES: Readonly<Record<string, Finding['severity']>> = { error: 'error', warning: 'warn' }

const toFinding = (record: StratumRecord): Finding | undefined => {
  const severity = SEVERITIES[record.severity ?? '']
  const isUsable = record.v === CONTRACT_VERSION && severity !== undefined && record.rule !== undefined && record.file !== undefined
  if (!isUsable) return undefined
  return {
    tool: 'stratum',
    rule: record.rule as string,
    severity,
    file: record.file as string,
    line: record.line ?? 1,
    message: record.message ?? '',
    ...(record.fix ? { fix: record.fix } : {}),
  }
}

export const parseStratum = (stdout: string): Finding[] =>
  stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => toFinding(JSON.parse(line) as StratumRecord))
    .filter((finding): finding is Finding => finding !== undefined)

export const runStratum = (tool: ToolWithConfig, projectRoot: string, files: readonly string[], timeoutMs: number): Promise<ToolRun> =>
  runTool({
    tool: 'stratum',
    argv: [...tool.bin, '--format', 'jsonl', '--config', tool.config, '--files', ...files],
    cwd: projectRoot,
    timeoutMs,
    okCodes: OK_CODES,
    parse: parseStratum,
  })
