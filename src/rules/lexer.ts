export type CommentKind = 'line' | 'block'

export interface Comment {
  text: string
  line: number
  kind: CommentKind
  start: number
  end: number
  isExportMember: boolean
}

const SCRIPT_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i
const VUE_EXTENSION = /\.vue$/i
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
const EXPORT_MODIFIERS = new Set(['default', 'abstract', 'declare', 'const'])
const EXPORT_BODY_KEYWORDS = new Set(['class', 'interface', 'enum'])

const countNewlines = (text: string, from: number, to: number): number => {
  let count = 0
  for (let index = from; index < to; index++) {
    if (text[index] === '\n') {
      count++
    }
  }
  return count
}

type ExportState = 'none' | 'modifiers' | 'declaration' | 'type-name' | 'type-value'

class ExportBodyTracker {
  private state: ExportState = 'none'
  private bodyDepth: number | undefined

  word(word: string, depth: number): void {
    if (depth !== 0) return
    if (word === 'export') {
      this.state = 'modifiers'
      return
    }
    if (this.state === 'type-value') {
      this.state = 'none'
      return
    }
    if (this.state !== 'modifiers') return
    if (EXPORT_MODIFIERS.has(word)) return
    if (word === 'type') {
      this.state = 'type-name'
      return
    }
    this.state = EXPORT_BODY_KEYWORDS.has(word) ? 'declaration' : 'none'
  }

  punctuator(char: string, depth: number): void {
    if (char === '{' && depth === 1) {
      const isBodyOpen = this.state === 'declaration' || this.state === 'type-value'
      this.bodyDepth = isBodyOpen ? depth : this.bodyDepth
      this.state = 'none'
      return
    }
    if (this.bodyDepth !== undefined && depth < this.bodyDepth) {
      this.bodyDepth = undefined
    }
    if (depth !== 0 || char === '{') return
    if (this.state === 'type-name' && char === '=') {
      this.state = 'type-value'
      return
    }
    const isTypeParameter = this.state === 'type-name' || this.state === 'declaration'
    if (char === ';' || !isTypeParameter) {
      this.state = 'none'
    }
  }

  other(): void {
    if (this.state === 'type-value' || this.state === 'modifiers') {
      this.state = 'none'
    }
  }

  isMember(depth: number): boolean {
    return this.bodyDepth !== undefined && depth === this.bodyDepth
  }
}

class JsLexer {
  private index = 0
  private line: number
  private isRegexAllowed = true
  private isInTemplate = false
  private readonly templateDepths: number[] = []
  private braceDepth = 0
  private readonly exportBody = new ExportBodyTracker()
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
      this.exportBody.other()
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
    const isInterpolationEnd = this.updateTemplateDepth(char)
    if (char === '{') {
      this.braceDepth++
    } else if (char === '}' && !isInterpolationEnd) {
      this.braceDepth--
    }
    this.exportBody.punctuator(char, this.braceDepth)
  }

  private updateTemplateDepth(char: string): boolean {
    const top = this.templateDepths.length - 1
    const depth = this.templateDepths[top]
    if (depth === undefined) return false
    if (char === '{') {
      this.templateDepths[top] = depth + 1
      return false
    }
    if (char !== '}') return false
    if (depth > 0) {
      this.templateDepths[top] = depth - 1
      return false
    }
    this.templateDepths.pop()
    this.isInTemplate = true
    return true
  }

  private isExportMember(): boolean {
    return this.templateDepths.length === 0 && this.exportBody.isMember(this.braceDepth)
  }

  private scanWord(): void {
    const start = this.index
    while (this.index < this.end && IDENTIFIER_PART.test(this.at())) {
      this.index++
    }
    const word = this.source.slice(start, this.index)
    this.isRegexAllowed = REGEX_KEYWORDS.has(word)
    this.exportBody.word(word, this.braceDepth)
  }

  private scanNumber(): void {
    this.exportBody.other()
    while (this.index < this.end && NUMBER_PART.test(this.at())) {
      this.index++
    }
    this.isRegexAllowed = false
  }

  private scanString(quote: string): void {
    this.exportBody.other()
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
    this.comments.push({ text, line: this.line, kind: 'line', start, end: this.index, isExportMember: this.isExportMember() })
  }

  private scanBlockComment(): void {
    const start = this.index
    const line = this.line
    const close = this.source.indexOf('*/', start + 2)
    const stop = close === -1 || close + 2 > this.end ? this.end : close + 2
    this.line += countNewlines(this.source, start, stop)
    this.index = stop
    const text = this.source.slice(start, stop)
    this.comments.push({ text, line, kind: 'block', start, end: stop, isExportMember: this.isExportMember() })
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
    this.exportBody.other()
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
    comments.push({ text: match[0], line: lineAt(source, match.index), kind: 'block', start: match.index, end, isExportMember: false })
  }
  return comments.sort((left, right) => left.end - right.end)
}

export const lexComments = (file: string, source: string): Comment[] | undefined => {
  if (SCRIPT_EXTENSION.test(file)) return lexJs(source)
  if (VUE_EXTENSION.test(file)) return lexVue(source)
  return undefined
}
