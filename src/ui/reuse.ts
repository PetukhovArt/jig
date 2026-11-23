import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UiComponents } from '../core/config-ui'
import { gitStatus } from '../core/git'
import { createMatcher } from '../core/glob'
import { exclusionOf } from '../review/review-plan'
import { formatFinding, type Finding } from '../tools/finding'
import { changedLines, isOnChangedLine, type ChangedLines } from '../tools/tool'
import { resolveUiBase } from './base'

export const REUSE_RULE = 'ui/raw-element'

export interface ReuseFinding extends Finding {
  element: string
  use: string
}

export interface ReuseResult {
  base: string
  files: number
  findings: ReuseFinding[]
}

const CREATE_CALLS = ['h', 'createElement', 'createVNode', 'createElementVNode', '_createElementVNode', 'jsx', 'jsxs', '_jsx', '_jsxs', 'jsxDEV', '_jsxDEV']
const COMMENT_START = /^\s*(?:\/\/|\/\*|\*|<!--)/

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const elementPatterns = (element: string): RegExp[] => {
  const name = escapeRegExp(element)
  return [
    new RegExp(`(?<![\\w$.])<${name}(?=[\\s/>]|$)`),
    new RegExp(`\\b(?:${CREATE_CALLS.join('|')})\\(\\s*(['"\`])${name}\\1`),
  ]
}

export const rawElementsIn = (text: string, elements: readonly string[], lines: ChangedLines): { line: number; element: string }[] => {
  const patterns = elements.map((element) => ({ element, patterns: elementPatterns(element) }))
  const found: { line: number; element: string }[] = []
  text.split(/\r?\n/).forEach((content, index) => {
    const line = index + 1
    if (!isOnChangedLine(lines, line) || COMMENT_START.test(content)) return
    for (const { element, patterns: own } of patterns) {
      if (own.some((pattern) => pattern.test(content))) found.push({ line, element })
    }
  })
  return found
}

export const changedFiles = (root: string, tracked: readonly string[]): string[] => {
  const untracked = (gitStatus(root) ?? []).filter((entry) => entry.status === '??').map((entry) => entry.path)
  return [...new Set([...tracked, ...untracked])].map((path) => path.replace(/\\/g, '/')).filter((path) => existsSync(join(root, path)))
}

export const checkReuse = (root: string, components: UiComponents, given: string | undefined): ReuseResult => {
  const base = resolveUiBase(root, given, 'ui reuse')
  const isComponentFile = createMatcher(components.files)
  const isShared = createMatcher(components.dirs.map((dir) => `${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/**`))
  const files = changedFiles(root, base.tracked).filter((path) => isComponentFile(path) && !isShared(path) && exclusionOf(path, root) === undefined)
  const lines = changedLines(root, files, base.mergeBase)
  const elements = Object.keys(components.map)
  const findings: ReuseFinding[] = []
  for (const file of files) {
    const own = lines.get(file)
    if (own === undefined) continue
    for (const { line, element } of rawElementsIn(readFileSync(join(root, file), 'utf8'), elements, own)) {
      const use = components.map[element] ?? ''
      findings.push({ tool: 'ui', rule: REUSE_RULE, severity: 'error', file, line, message: `use ${use} instead of <${element}>`, element, use })
    }
  }
  return { base: base.label, files: files.length, findings }
}

export const formatReuse = (result: ReuseResult): string[] => {
  const lines = result.findings.map(formatFinding)
  const summary = result.findings.length === 0 ? 'no raw elements on changed lines' : `${result.findings.length} raw elements on changed lines`
  return [...lines, `ui reuse: ${summary} (${result.files} component files read, base ${result.base})`]
}
