export interface ShellSegment {
  words: string[]
  redirects: string[]
}

const SEGMENT_BREAKS = new Set([';', '&', '|', '\n', '(', ')'])
const BLANK = /\s/
const FD_NUMBER = /^\d+$/
const FD_TARGET = /[\d-]/

class ShellTokenizer {
  private index = 0
  private token = ''
  private hasToken = false
  private isTokenQuoted = false
  private isRedirectNext = false
  private segment: ShellSegment = { words: [], redirects: [] }
  readonly segments: ShellSegment[] = []

  constructor(private readonly command: string) {}

  run(): ShellSegment[] {
    while (this.index < this.command.length) {
      this.step(this.command[this.index] ?? '')
    }
    this.endSegment()
    return this.segments
  }

  private step(char: string): void {
    if (char === '"' || char === "'") {
      this.scanQuoted(char)
      return
    }
    if (char === '>' || (char === '&' && this.command[this.index + 1] === '>')) {
      this.scanRedirect()
      return
    }
    this.index++
    if (SEGMENT_BREAKS.has(char)) {
      this.endSegment()
      return
    }
    if (BLANK.test(char) || char === '<') {
      this.endToken()
      return
    }
    this.token += char
    this.hasToken = true
  }

  private scanQuoted(quote: string): void {
    this.index++
    this.hasToken = true
    this.isTokenQuoted = true
    while (this.index < this.command.length && this.command[this.index] !== quote) {
      const isEscape = quote === '"' && this.command[this.index] === '\\' && this.index + 1 < this.command.length
      if (isEscape) {
        this.index++
      }
      this.token += this.command[this.index]
      this.index++
    }
    this.index++
  }

  private scanRedirect(): void {
    const isFdPrefix = this.hasToken && !this.isTokenQuoted && FD_NUMBER.test(this.token)
    if (isFdPrefix) {
      this.resetToken()
    } else {
      this.endToken()
    }
    if (this.command[this.index] === '&') {
      this.index++
    }
    while (this.command[this.index] === '>') {
      this.index++
    }
    if (this.command[this.index] !== '&') {
      this.isRedirectNext = true
      return
    }
    this.index++
    while (FD_TARGET.test(this.command[this.index] ?? '')) {
      this.index++
    }
  }

  private resetToken(): void {
    this.token = ''
    this.hasToken = false
    this.isTokenQuoted = false
  }

  private endToken(): void {
    if (this.hasToken) {
      const target = this.isRedirectNext ? this.segment.redirects : this.segment.words
      target.push(this.token)
      this.isRedirectNext = false
    }
    this.resetToken()
  }

  private endSegment(): void {
    this.endToken()
    this.isRedirectNext = false
    const isEmpty = this.segment.words.length === 0 && this.segment.redirects.length === 0
    if (!isEmpty) {
      this.segments.push(this.segment)
    }
    this.segment = { words: [], redirects: [] }
  }
}

export const splitShell = (command: string): ShellSegment[] => new ShellTokenizer(command).run()
