import { toSlash } from '../core/paths'

export interface Finding {
  tool: string
  rule: string
  severity: 'error' | 'warn'
  file: string
  line: number
  message: string
  fix?: string
}

export const POST_EDIT_LINE_LIMIT = 15
export const STOP_LINE_LIMIT = 20

export const formatFinding = (finding: Finding): string =>
  `${finding.file}:${finding.line} ${finding.rule} → ${finding.fix ?? finding.message}`

export const formatDenial = (finding: Finding): string => finding.message

interface FindingGroup {
  first: Finding
  count: number
}

export const collapseFindings = (findings: readonly Finding[]): string[] => {
  const groups = new Map<string, FindingGroup>()
  for (const finding of findings) {
    const key = `${finding.rule}\u0000${finding.file}`
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, { first: finding, count: 1 })
      continue
    }
    group.count++
    if (finding.line < group.first.line) {
      group.first = finding
    }
  }
  return [...groups.values()].map(({ first, count }) =>
    count === 1 ? formatFinding(first) : `${formatFinding(first)} (×${count})`,
  )
}

export const truncationLine = (hidden: number, pluginRoot: string): string =>
  `… ${hidden} more (run: node ${toSlash(pluginRoot)}/bin/jig.mjs check stop)`

export const limitLines = (lines: readonly string[], limit: number, pluginRoot: string): string[] => {
  if (lines.length <= limit) return [...lines]
  const kept = lines.slice(0, limit - 1)
  return [...kept, truncationLine(lines.length - kept.length, pluginRoot)]
}

export const formatFindings = (findings: readonly Finding[], limit: number, pluginRoot: string): string[] =>
  limitLines(collapseFindings(findings), limit, pluginRoot)
