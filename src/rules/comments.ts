import { join } from 'node:path'
import type { JigConfig } from '../core/config'
import { resolvePluginRoot, toSlash } from '../core/paths'
import type { Finding } from '../tools/finding'
import { lexComments, type Comment } from './lexer'
import { activeSeverity, fileLine, jigFinding, type Edit } from './rule'

const RULE = 'jig/comments'
const LICENSE_HEADER_LINES = 15
const LICENSE = /SPDX-License-Identifier|copyright|license/i
const TICKET_TODO = /^\s*(?:\/\/+|\/\*+|\*)?\s*TODO\((?:[A-Z][A-Z0-9]+-\d+|#\d+)\):\s*\S/
const EXTERNAL_LINK = /https?:\/\//
const TOOL_DIRECTIVES: readonly RegExp[] = [
  /^\s*\/\/\/\s*<reference\b/,
  /@stratum-purity\s+\d/,
  /@vite-ignore/,
  /webpack[A-Z]\w*\s*:/,
  /[@#]__PURE__/,
]
const DECORATOR_NAME = /^@[\w$.]+/
const EXPORT_KEYWORD = /^export\b/
const LEADING_WHITESPACE = /^\s+/

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

const skipParentheses = (source: string, start: number): number => {
  let depth = 0
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
      if (depth === 0) return index + 1
    }
  }
  return source.length
}

const isFollowedByExport = (source: string, end: number): boolean => {
  let rest = source.slice(end)
  for (;;) {
    rest = rest.replace(LEADING_WHITESPACE, '')
    const decorator = DECORATOR_NAME.exec(rest)
    if (decorator === null) return EXPORT_KEYWORD.test(rest)
    rest = rest.slice(decorator[0].length)
    if (rest.startsWith('(')) {
      rest = rest.slice(skipParentheses(rest, 0))
    }
  }
}

const isAllowed = (comment: Comment, source: string): boolean => {
  const { text } = comment
  const isLicense = comment.line <= LICENSE_HEADER_LINES && LICENSE.test(text)
  const isPublicJsDoc = comment.kind === 'block' && text.startsWith('/**') && isFollowedByExport(source, comment.end)
  return (
    isLicense ||
    TICKET_TODO.test(text) ||
    isPublicJsDoc ||
    EXTERNAL_LINK.test(text) ||
    TOOL_DIRECTIVES.some((directive) => directive.test(text))
  )
}

const countExisting = (file: string, edits: Edit[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const edit of edits) {
    for (const comment of lexComments(file, edit.before) ?? []) {
      const key = normalize(comment.text)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

export const checkComments = (file: string, edits: Edit[], config: JigConfig): Finding[] => {
  const severity = activeSeverity(config, RULE)
  if (severity === undefined) return []
  if (lexComments(file, '') === undefined) return []
  const existing = countExisting(file, edits)
  const atom = toSlash(join(resolvePluginRoot(), 'atoms', 'comments.md'))
  const findings: Finding[] = []
  for (const edit of edits) {
    for (const comment of lexComments(file, edit.after) ?? []) {
      const key = normalize(comment.text)
      const remaining = existing.get(key) ?? 0
      if (remaining > 0) {
        existing.set(key, remaining - 1)
        continue
      }
      const line = fileLine(edit, comment.line)
      if (isAllowed({ ...comment, line }, edit.after)) continue
      const message = `${RULE}: new comment at ${file}:${line} is not allowed. Allowed: license header, TODO(<TICKET-1>), JSDoc on an export, an external constraint with a link, a tool directive. Remove it and express the intent in code (atom comments: ${atom}).`
      findings.push(jigFinding(RULE, severity, { file, line, message }))
    }
  }
  return findings
}
