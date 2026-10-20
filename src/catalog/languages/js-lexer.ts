export type CommentKind = 'line' | 'block' | 'directive'

export interface Comment {
  text: string
  line: number
  kind: CommentKind
  start: number
  end: number
}

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else'])
const DIVISION_AFTER = new Set([')', ']'])
const IDENTIFIER_START = /[A-Za-z_$\u0080-￿]/
const IDENTIFIER_PART = /[\w$\u0080-￿]/
const DIGIT = /\d/
const NUMBER_PART = /[\w.]/
const WHITESPACE = /\s/
const SCRIPT_BLOCK = /(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const SFC_TAG = /<(?:script|template|style)\b/i

export const countNewlines = (text: string, from: number, to: number): number => {
  let count = 0
  for (let index = from; index < to; index++) {
    if (text[index] === '\n') {
      count++
    }
  }
  return count
}

class JsLexer {
  private index = 0
  private line: number
  private isRegexAllowed = true
  private isInTemplate = false
  private readonly templateDepths: number[] = []
  readonly comments: Comment[] = []

  constructor(
    private readonly source: string,
    private readonly end: number,
    start: number,
    firstLine: number,
  ) {
    this.index = start
    this.line = firstLine
  }

  run(): Comment[] {
    while (this.index < this.end) {
      if (this.isInTemplate) {
        this.scanTemplate()
        continue
      }
      this.scanCode()
    }
    return this.comments
  }

  private at(offset = 0): string {
    const position = this.index + offset
    return position < this.end ? (this.source[position] ?? '') : ''
  }

  private advance(): void {
    if (this.source[this.index] === '\n') {
      this.line++
    }
    this.index++
  }

  private scanCode(): void {
    const char = this.at()
    if (WHITESPACE.test(char)) {
      this.advance()
      return
    }
    if (char === '/') {
      this.scanSlash()
      return
    }
    if (char === '"' || char === "'") {
      this.scanString(char)
      return
    }
    if (char === '`') {
      this.index++
      this.isInTemplate = true
      return
    }
    if (IDENTIFIER_START.test(char)) {
      this.scanWord()
      return
    }
    if (DIGIT.test(char)) {
      this.scanNumber()
      return
    }
    this.scanPunctuator(char)
  }

  private scanPunctuator(char: string): void {
    this.index++
    this.isRegexAllowed = !DIVISION_AFTER.has(char)
    this.updateTemplateDepth(char)
  }

  private updateTemplateDepth(char: string): void {
    const top = this.templateDepths.length - 1
    const depth = this.templateDepths[top]
    if (depth === undefined) return
    if (char === '{') {
      this.templateDepths[top] = depth + 1
      return
    }
    if (char !== '}') return
    if (depth > 0) {
      this.templateDepths[top] = depth - 1
      return
    }
    this.templateDepths.pop()
    this.isInTemplate = true
  }

  private scanWord(): void {
    const start = this.index
    while (this.index < this.end && IDENTIFIER_PART.test(this.at())) {
      this.index++
    }
    this.isRegexAllowed = REGEX_KEYWORDS.has(this.source.slice(start, this.index))
  }

  private scanNumber(): void {
    while (this.index < this.end && NUMBER_PART.test(this.at())) {
      this.index++
    }
    this.isRegexAllowed = false
  }

  private scanString(quote: string): void {
    this.index++
    while (this.index < this.end) {
      const char = this.at()
      if (char === '\\') {
        this.index++
        this.advance()
        continue
      }
      if (char === quote || char === '\n') break
      this.index++
    }
    if (this.at() === quote) {
      this.index++
    }
    this.isRegexAllowed = false
  }

  private scanTemplate(): void {
    while (this.index < this.end) {
      const char = this.at()
      if (char === '\\') {
        this.index++
        this.advance()
        continue
      }
      if (char === '`') {
        this.index++
        this.isInTemplate = false
        this.isRegexAllowed = false
        return
      }
      if (char === '$' && this.at(1) === '{') {
        this.index += 2
        this.templateDepths.push(0)
        this.isInTemplate = false
        this.isRegexAllowed = true
        return
      }
      this.advance()
    }
  }

  private scanSlash(): void {
    const next = this.at(1)
    if (next === '/') {
      this.scanLineComment()
      return
    }
    if (next === '*') {
      this.scanBlockComment()
      return
    }
    if (this.isRegexAllowed && this.scanRegex()) return
    this.index++
    this.isRegexAllowed = true
  }

  private scanLineComment(): void {
    const start = this.index
    while (this.index < this.end && this.at() !== '\n') {
      this.index++
    }
    const text = this.source.slice(start, this.index).replace(/\r$/, '')
    this.comments.push({ text, line: this.line, kind: 'line', start, end: this.index })
  }

  private scanBlockComment(): void {
    const start = this.index
    const line = this.line
    const close = this.source.indexOf('*/', start + 2)
    const stop = close === -1 || close + 2 > this.end ? this.end : close + 2
    this.line += countNewlines(this.source, start, stop)
    this.index = stop
    const text = this.source.slice(start, stop)
    this.comments.push({ text, line, kind: 'block', start, end: stop })
  }

  private scanRegex(): boolean {
    let position = this.index + 1
    let isInClass = false
    while (position < this.end) {
      const char = this.source[position]
      if (char === '\n') return false
      if (char === '\\') {
        position += 2
        continue
      }
      if (char === '[') {
        isInClass = true
      } else if (char === ']') {
        isInClass = false
      } else if (char === '/' && !isInClass) {
        break
      }
      position++
    }
    if (position >= this.end) return false
    position++
    while (position < this.end && IDENTIFIER_PART.test(this.source[position] ?? '')) {
      position++
    }
    this.index = position
    this.isRegexAllowed = false
    return true
  }
}

const skipShebang = (source: string): number => {
  if (!source.startsWith('#!')) return 0
  const newline = source.indexOf('\n')
  return newline === -1 ? source.length : newline
}

export const lexJs = (source: string): Comment[] => new JsLexer(source, source.length, skipShebang(source), 1).run()

interface Range {
  start: number
  end: number
}

const lineAt = (source: string, offset: number): number => countNewlines(source, 0, offset) + 1

const isInside = (offset: number, ranges: readonly Range[]): boolean =>
  ranges.some((range) => offset >= range.start && offset < range.end)

export const lexVue = (source: string): Comment[] => {
  const comments: Comment[] = SFC_TAG.test(source) ? [] : lexJs(source)
  const skipped: Range[] = []
  for (const match of source.matchAll(SCRIPT_BLOCK)) {
    const start = match.index + (match[1]?.length ?? 0)
    const end = start + (match[2]?.length ?? 0)
    comments.push(...new JsLexer(source, end, start, lineAt(source, start)).run())
    skipped.push({ start: match.index, end: match.index + match[0].length })
  }
  for (const match of source.matchAll(STYLE_BLOCK)) {
    skipped.push({ start: match.index, end: match.index + match[0].length })
  }
  for (const match of source.matchAll(HTML_COMMENT)) {
    if (isInside(match.index, skipped)) continue
    const end = match.index + match[0].length
    comments.push({ text: match[0], line: lineAt(source, match.index), kind: 'block', start: match.index, end })
  }
  return comments.sort((left, right) => left.end - right.end)
}
