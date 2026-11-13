import { blockEnd, commentLexer, lineEnd, skipQuoted, type Range, type RangeLexer } from './lexer'

const URL_START = /^url\(/i
const NAME_PART = /[\w-]/

export const cssRanges =
  (lineComments: boolean): RangeLexer =>
  (text) => {
    const found: Range[] = []
    const n = text.length
    let i = 0
    while (i < n) {
      const c = text[i] ?? ''
      const d = text[i + 1]
      if (c === '/' && (d === '*' || (d === '/' && lineComments))) {
        const end = d === '*' ? blockEnd(text, i) : lineEnd(text, i)
        found.push({ start: i, end })
        i = end
      } else if (c === '"' || c === "'") i = skipQuoted(text, i, c)
      else if ((c === 'u' || c === 'U') && URL_START.test(text.slice(i, i + 4)) && !NAME_PART.test(text[i - 1] ?? '')) {
        i += 4
        while (i < n && text[i] !== ')') {
          const quote = text[i] ?? ''
          i = quote === '"' || quote === "'" ? skipQuoted(text, i, quote) : i + 1
        }
      } else i++
    }
    return found
  }

export const lexCss = commentLexer(cssRanges(false))

export const lexScss = commentLexer(cssRanges(true))
