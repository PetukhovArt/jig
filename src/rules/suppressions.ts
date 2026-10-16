import type { JigConfig } from '../core/config'
import type { Finding } from '../tools/finding'
import { activeSeverity, fileLine, jigFinding, type Edit } from './rule'

const RULE = 'jig/suppressions'

const DIRECTIVES: readonly RegExp[] = [
  /\beslint-disable(?:-next-line|-line)?\b/,
  /\boxlint-disable(?:-next-line|-line)?\b/,
  /\bbiome-ignore\b/,
  /@ts-(?:ignore|expect-error|nocheck)\b/,
  /\bstratum-ignore\b/,
]

const LINE_BREAK = /\r?\n/

export const findDirective = (line: string): string | undefined => {
  for (const directive of DIRECTIVES) {
    const match = directive.exec(line)
    if (match !== null) return match[0]
  }
  return undefined
}

export const checkSuppressions = (file: string, edits: Edit[], config: JigConfig): Finding[] => {
  const severity = activeSeverity(config, RULE)
  if (severity === undefined) return []
  const existing = new Set(edits.flatMap((edit) => edit.before.split(LINE_BREAK).map((line) => line.trim())))
  const findings: Finding[] = []
  for (const edit of edits) {
    edit.after.split(LINE_BREAK).forEach((text, index) => {
      if (existing.has(text.trim())) return
      const directive = findDirective(text)
      if (directive === undefined) return
      const line = fileLine(edit, index + 1)
      const message = `${RULE}: "${directive}" at ${file}:${line} silences a check. Fix the cause instead; only a human adds suppressions.`
      findings.push(jigFinding(RULE, severity, { file, line, message }))
    })
  }
  return findings
}
