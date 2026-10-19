import type { Finding } from '../../tools/finding'
import { defineTool, groupByMarker, nearestMarker, runTool, withMarker, type ToolRun, type ToolWithConfig } from '../../tools/tool'
import { SCRIPT_FILES } from '../languages'

interface StratumRecord {
  v?: number
  rule?: string
  severity?: string
  file?: string
  line?: number
  message?: string
  fix?: string
}

export const STRATUM_CONFIG = 'stratum.config.jsonc'
export const STRATUM_TIMEOUT_MS = 15_000

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

export const stratumTool = defineTool({
  name: 'stratum',
  binaries: [
    {
      key: 'stratum',
      label: 'stratum',
      command: 'stratum-lint',
      packages: ['@petukhovart/stratum-lint'],
      configs: [STRATUM_CONFIG],
      requiresConfig: true,
    },
  ],
  files: SCRIPT_FILES,
  setup: ['stratum-lint init', 'stratum-lint baseline'],
  parse: (stdout) => parseStratum(stdout),
  comments: { suppressions: [/\bstratum-ignore\b/], allowed: [/@stratum-purity\s+\d/] },
  edit: async (tools, projectRoot, file, timeoutMs) => {
    const entry = withMarker(tools.stratum, nearestMarker(projectRoot, file, [STRATUM_CONFIG]))
    if (entry === undefined) return undefined
    return runStratum(entry, projectRoot, [file], timeoutMs)
  },
  stop: async (tools, input) => {
    const entry = tools.stratum
    if (entry === undefined) return { runs: [], findings: [] }
    const { groups, skipped } = groupByMarker(input.projectRoot, input.files, [STRATUM_CONFIG])
    for (const file of skipped) {
      input.notes.push({ kind: 'gate-skipped', tool: 'jig', rule: 'gate/stratum', file, message: 'no stratum config above the file' })
    }
    const runs: ToolRun[] = []
    for (const group of groups) {
      const timeoutMs = input.budget(STRATUM_TIMEOUT_MS)
      if (timeoutMs === 0) break
      runs.push(await runStratum({ bin: entry.bin, config: group.marker }, input.projectRoot, group.files, timeoutMs))
    }
    return { runs, findings: runs.flatMap((toolRun) => toolRun.findings) }
  },
})
