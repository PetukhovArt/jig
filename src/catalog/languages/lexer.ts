export type CommentKind = 'line' | 'block' | 'directive'

export interface Comment {
  text: string
  line: number
  kind: CommentKind
}

export interface Range {
  start: number
  end: number
}

export type RangeLexer = (text: string) => Range[]

export const WORD = /[\p{L}\p{N}_$]/u

export const countNewlines = (text: string, from: number, to: number): number => {
  let count = 0
  for (let index = from; index < to; index++) {
    if (text[index] === '\n') {
      count++
    }
  }
  return count
}

export const lineEnd = (text: string, index: number): number => {
  const end = text.indexOf('\n', index)
  return end === -1 ? text.length : end
}

export const blockEnd = (text: string, index: number): number => {
  const end = text.indexOf('*/', index + 2)
  return end === -1 ? text.length : end + 2
}

export const skipQuoted = (text: string, from: number, quote: string, escapes = true, multiline = false): number => {
  let index = from + 1
  while (index < text.length && text[index] !== quote) {
    if (text[index] === '\n' && !multiline) return index
    index += escapes && text[index] === '\\' ? 2 : 1
  }
  return index + 1
}

const blankShebang = (source: string): string => {
  if (!source.startsWith('#!')) return source
  const end = lineEnd(source, 0)
  return ' '.repeat(end) + source.slice(end)
}

const kindOf = (text: string): CommentKind => (text.startsWith('/*') || text.startsWith('<!--') ? 'block' : 'line')

export const commentLexer =
  (lex: RangeLexer) =>
  (source: string): Comment[] => {
    const code = blankShebang(source)
    const ranges = lex(code).sort((left, right) => left.start - right.start)
    let line = 1
    let counted = 0
    return ranges.map(({ start, end }) => {
      line += countNewlines(code, counted, start)
      counted = start
      const text = code.slice(start, end).replace(/\r$/, '')
      return { text, line, kind: kindOf(text) }
    })
  }
