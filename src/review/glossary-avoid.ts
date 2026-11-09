import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../core/git'
import { createMatcher } from '../core/glob'
import { isUnreviewed } from './diff-files'
import type { ReviewInputs } from './rule-docs'

export interface AvoidHit {
  file: string
  line: number
  lines: number
  word: string
  glossary: string
  glossaryLine: number
  quote: string
}

interface AvoidTerm {
  words: string[]
  word: string
  line: number
  quote: string
}

const AVOID_MARKER = /(?:^|[\s(|>*_-])[_*]{0,2}(?:avoid|не\s+использовать|избегать)[_*]{0,2}\s*:\s*[_*]{0,2}/iu
const isMarkdown = createMatcher(['**/*.md'])

const wordsOf = (text: string): string[] =>
  (text.match(/[\p{L}\p{N}]+/gu) ?? []).flatMap((token) => token.split(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u)).map((word) => word.toLowerCase())

const cleanTerm = (raw: string): string =>
  raw
    .replace(/\([^)]*\)/g, '')
    .replace(/[`"'«»“”*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.:]+$/, '')
    .trim()

const avoidTerms = (text: string): AvoidTerm[] =>
  text.split(/\r?\n/).flatMap((source, index) => {
    const marker = AVOID_MARKER.exec(source)
    if (marker === null) return []
    return source
      .slice(marker.index + marker[0].length)
      .split(/[,;/]/)
      .map(cleanTerm)
      .filter((word) => word !== '')
      .map((word) => ({ word, words: wordsOf(word), line: index + 1, quote: source.trim() }))
      .filter((term) => term.words.length > 0)
  })

const holds = (haystack: readonly string[], needle: readonly string[]): boolean =>
  haystack.some((_, start) => needle.every((word, offset) => haystack[start + offset] === word))

interface AddedLine {
  file: string
  line: number
  text: string
}

const addedLines = (root: string, mergeBase: string, paths: readonly string[]): AddedLine[] => {
  const result = git(['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', mergeBase, ...(paths.length > 0 ? ['--', ...paths] : [])], root)
  if (!result.ok) throw new Error(`git diff ${mergeBase} failed: ${result.stderr.trim()}`)
  const lines: AddedLine[] = []
  let file: string | undefined
  let next = 0
  for (const raw of result.stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('+++ ')) {
      const path = line.slice(4)
      file = path === '/dev/null' ? undefined : path.replace(/^b\//, '')
    } else if (line.startsWith('@@')) {
      next = Number(/\+(\d+)/.exec(line)?.[1] ?? 0)
    } else if (line.startsWith('+') && file !== undefined) {
      lines.push({ file, line: next, text: line.slice(1) })
      next += 1
    }
  }
  return lines
}

const covers = (scope: string, file: string): boolean => scope === '' || file.startsWith(`${scope}/`)

export const glossaryAvoidHits = (root: string, mergeBase: string, paths: readonly string[], inputs: ReviewInputs): AvoidHit[] => {
  const glossaries = inputs.glossaries.map((path) => ({ path, scope: inputs.scopes[path] ?? '', terms: avoidTerms(readFileSync(join(root, path), 'utf8')) }))
  if (glossaries.every((glossary) => glossary.terms.length === 0)) return []
  const hits = new Map<string, AvoidHit>()
  for (const added of addedLines(root, mergeBase, paths)) {
    if (isMarkdown(added.file) || isUnreviewed(added.file)) continue
    const words = wordsOf(added.text)
    for (const glossary of glossaries) {
      if (!covers(glossary.scope, added.file)) continue
      for (const term of glossary.terms) {
        if (!holds(words, term.words)) continue
        const key = `${added.file}\0${glossary.path}\0${term.line}\0${term.word}`
        const hit = hits.get(key)
        if (hit === undefined) hits.set(key, { file: added.file, line: added.line, lines: 1, word: term.word, glossary: glossary.path, glossaryLine: term.line, quote: term.quote })
        else hit.lines += 1
      }
    }
  }
  return [...hits.values()]
}
