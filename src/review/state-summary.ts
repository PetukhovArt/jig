import { readFileSync } from 'node:fs'

type Command = (args: string[]) => number

interface SummaryFinding {
  id?: string
  file?: string
  line?: number
  angle?: number
  severity?: string
  status?: string
  discussion_id?: string
  summary?: string
}

interface SummaryState {
  key?: string
  target?: string
  base_sha?: string
  last_reviewed_sha?: string
  diff_hash?: string
  runs?: number
  tally?: Record<string, number>
  findings?: SummaryFinding[]
  deepening?: unknown
}

const SUMMARY_WIDTH = 100
const SHA_WIDTH = 12

const short = (value: string | undefined, width: number): string => {
  if (value === undefined) return '-'
  return value.length > width ? `${value.slice(0, width - 1)}…` : value
}

export const summarizeState = (state: SummaryState): string => {
  const findings = state.findings ?? []
  const byStatus = new Map<string, number>()
  findings.forEach((finding) => byStatus.set(finding.status ?? '?', (byStatus.get(finding.status ?? '?') ?? 0) + 1))
  const tally = Object.entries(state.tally ?? {})
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${count}`)
    .join(', ')
  return [
    `key ${state.key ?? '-'} · target ${state.target ?? '-'} · runs ${state.runs ?? 0} · base ${short(state.base_sha, SHA_WIDTH)} · last reviewed ${short(state.last_reviewed_sha, SHA_WIDTH)} · diff hash ${short(state.diff_hash, SHA_WIDTH)}`,
    `tally: ${tally === '' ? 'all zero' : tally}`,
    `findings: ${findings.length}${byStatus.size > 0 ? ` (${[...byStatus.entries()].map(([status, count]) => `${status} ${count}`).join(', ')})` : ''} · deepening ${state.deepening === undefined ? 'no' : 'yes'}`,
    ...findings.map(
      (finding) =>
        `  ${finding.status ?? '?'} · ${finding.severity ?? '?'} · angle ${finding.angle ?? '?'} · ${finding.file ?? '?'}:${finding.line ?? '?'} · thread ${short(finding.discussion_id, SHA_WIDTH)} · ${finding.id ?? '?'} · ${short(finding.summary, SUMMARY_WIDTH)}`,
    ),
  ].join('\n')
}

export const runReviewState: Command = (args) => {
  const [path] = args
  if (path === undefined || args.length > 1) throw new Error('usage: jig review state <state file>')
  process.stdout.write(`${summarizeState(JSON.parse(readFileSync(path, 'utf8')) as SummaryState)}\n`)
  return 0
}
