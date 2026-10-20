import { countNewlines, type Comment } from './js-lexer'

const MESSAGE_DIRECTIVE = /^#\s*(?:region|endregion|error|warning)\b/
const CHECK_DIRECTIVE = /^#\s*(?:pragma|nullable)\b/
const TRAILING_COMMENT = /\s*\/\/.*$/

class CSharpLexer {
  private index = 0
  private line = 1
  readonly comments: Comment[] = []

  constructor(private readonly source: string) {}

  run(): Comment[] {
    this.scanCode(0)
    return this.comments
  }

  private at(offset = 0): string {
    return this.source[this.index + offset] ?? ''
  }

  private advance(): void {
    if (this.source[this.index] === '\n') {
      this.line++
    }
    this.index++
  }

  private runLength(char: string): number {
    let length = 0
    while (this.at(length) === char) {
      length++
    }
    return length
  }

  private lineEnd(): number {
    const newline = this.source.indexOf('\n', this.index)
    return newline === -1 ? this.source.length : newline
  }

  private scanCode(closingBraces: number): void {
    let depth = 0
    while (this.index < this.source.length) {
      const char = this.at()
      if (char === '}' && depth === 0 && closingBraces > 0) {
        this.index += Math.min(this.runLength('}'), closingBraces)
        return
      }
      if (char === '{') {
        depth++
      } else if (char === '}') {
        depth--
      }
      this.scanToken(char)
    }
  }

  private scanToken(char: string): void {
    if (char === '/' && this.at(1) === '/') {
      this.scanLineComment()
      return
    }
    if (char === '/' && this.at(1) === '*') {
      this.scanBlockComment()
      return
    }
    if (char === '#') {
      this.scanDirective()
      return
    }
    if (char === "'") {
      this.scanChar()
      return
    }
    if (char === '"' || char === '$' || char === '@') {
      this.scanString()
      return
    }
    this.advance()
  }

  private scanString(): void {
    let dollars = 0
    let isVerbatim = false
    while (this.at() === '$' || this.at() === '@') {
      if (this.at() === '$') {
        dollars++
      } else {
        isVerbatim = true
      }
      this.index++
    }
    if (this.at() !== '"') return
    const quotes = this.runLength('"')
    if (quotes >= 3 && !isVerbatim) {
      this.scanRawString(quotes, dollars)
      return
    }
    this.index++
    this.scanQuotedString(isVerbatim, dollars > 0)
  }

  private scanQuotedString(isVerbatim: boolean, isInterpolated: boolean): void {
    while (this.index < this.source.length) {
      const char = this.at()
      if (char === '\\' && !isVerbatim) {
        this.index++
        this.advance()
        continue
      }
      if (char === '"') {
        const isEscaped = isVerbatim && this.at(1) === '"'
        this.index += isEscaped ? 2 : 1
        if (isEscaped) continue
        return
      }
      if (char === '\n' && !isVerbatim) return
      if (isInterpolated && (char === '{' || char === '}') && this.at(1) === char) {
        this.index += 2
        continue
      }
      if (isInterpolated && char === '{') {
        this.index++
        this.scanCode(1)
        continue
      }
      this.advance()
    }
  }

  private scanRawString(quotes: number, dollars: number): void {
    this.index += quotes
    while (this.index < this.source.length) {
      const char = this.at()
      if (char === '"') {
        const run = this.runLength('"')
        this.index += run
        if (run >= quotes) return
        continue
      }
      if (char === '{' && dollars > 0) {
        const run = this.runLength('{')
        this.index += run
        if (run >= dollars) {
          this.scanCode(dollars)
        }
        continue
      }
      this.advance()
    }
  }

  private scanChar(): void {
    this.index++
    while (this.index < this.source.length) {
      const char = this.at()
      if (char === '\\') {
        this.index++
        this.advance()
        continue
      }
      if (char === '\n') return
      this.index++
      if (char === "'") return
    }
  }

  private scanLineComment(): void {
    const start = this.index
    this.index = this.lineEnd()
    const text = this.source.slice(start, this.index).replace(/\r$/, '')
    this.comments.push({ text, line: this.line, kind: 'line', start, end: this.index })
  }

  private scanBlockComment(): void {
    const start = this.index
    const line = this.line
    const close = this.source.indexOf('*/', start + 2)
    const stop = close === -1 ? this.source.length : close + 2
    this.line += countNewlines(this.source, start, stop)
    this.index = stop
    this.comments.push({ text: this.source.slice(start, stop), line, kind: 'block', start, end: stop })
  }

  private scanDirective(): void {
    const start = this.index
    const lineText = this.source.slice(start, this.lineEnd()).replace(/\r$/, '')
    if (MESSAGE_DIRECTIVE.test(lineText)) {
      this.index = this.lineEnd()
      return
    }
    this.index++
    if (!CHECK_DIRECTIVE.test(lineText)) return
    const text = lineText.replace(TRAILING_COMMENT, '')
    this.comments.push({ text, line: this.line, kind: 'directive', start, end: start + text.length })
  }
}

export const lexCSharp = (source: string): Comment[] => new CSharpLexer(source).run()
