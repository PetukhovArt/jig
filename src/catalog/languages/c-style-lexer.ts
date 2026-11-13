import { blockEnd, commentLexer, lineEnd, skipQuoted, WORD, type Range } from './lexer'

type LiteralEnd = (text: string, index: number) => number | undefined

const RUST_RAW_STRING = /^b?r(#*)"/
const RUST_CHAR = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'/u

const nestedBlockEnd = (text: string, from: number): number => {
  let depth = 0
  let i = from
  while (i < text.length) {
    const pair = text.slice(i, i + 2)
    if (pair === '/*') depth++
    else if (pair === '*/') depth--
    i += pair === '/*' || pair === '*/' ? 2 : 1
    if (depth === 0) return i
  }
  return text.length
}

const cStyleRanges =
  (nested: boolean, literalEnd: LiteralEnd) =>
  (text: string): Range[] => {
    const found: Range[] = []
    let i = 0
    while (i < text.length) {
      const c = text[i]
      const d = text[i + 1]
      if (c === '/' && (d === '/' || d === '*')) {
        const end = d === '/' ? lineEnd(text, i) : nested ? nestedBlockEnd(text, i) : blockEnd(text, i)
        found.push({ start: i, end })
        i = end
      } else i = literalEnd(text, i) ?? i + 1
    }
    return found
  }

const goLiteralEnd: LiteralEnd = (text, i) => {
  const c = text[i]
  if (c === '"' || c === "'") return skipQuoted(text, i, c)
  if (c === '`') return skipQuoted(text, i, '`', false, true)
  return undefined
}

const rustLiteralEnd: LiteralEnd = (text, i) => {
  const c = text[i]
  if ((c === 'r' || c === 'b') && !WORD.test(text[i - 1] ?? '')) {
    const raw = RUST_RAW_STRING.exec(text.slice(i, i + 260))
    if (raw !== null) {
      const hashes = raw[1] ?? ''
      const close = text.indexOf(`"${hashes}`, i + raw[0].length)
      return close === -1 ? text.length : close + 1 + hashes.length
    }
  }
  if (c === '"') return skipQuoted(text, i, '"', true, true)
  if (c === "'") return i + (RUST_CHAR.exec(text.slice(i, i + 12))?.[0].length ?? 1)
  return undefined
}

export const lexRust = commentLexer(cStyleRanges(true, rustLiteralEnd))

export const lexGo = commentLexer(cStyleRanges(false, goLiteralEnd))
