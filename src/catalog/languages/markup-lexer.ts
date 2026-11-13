import { cssRanges } from './css-lexer'
import { jsRanges } from './js-lexer'
import { commentLexer, skipQuoted, type Range, type RangeLexer } from './lexer'

const jsx = jsRanges(true)
const ts = jsRanges(false)
const scss = cssRanges(true)

const EMBEDDED: Readonly<Record<string, RangeLexer>> = {
  js: jsx,
  jsx,
  mjs: jsx,
  cjs: jsx,
  tsx: jsx,
  ts,
  mts: ts,
  cts: ts,
  css: cssRanges(false),
  scss,
  less: scss,
}

const TAG_START = /[a-zA-Z/!]/
const EMBEDDED_BLOCK = /^<(script|style)[\s>]/
const LANG = /\blang\s*=\s*["']?(\w+)/
const SFC_TAG = /<(?:script|template|style)\b/i

const tagEnd = (text: string, from: number): number => {
  let i = from
  while (i < text.length && text[i] !== '>') {
    const c = text[i] ?? ''
    i = c === '"' || c === "'" ? skipQuoted(text, i, c, false, true) : i + 1
  }
  return i + 1
}

const markupRanges: RangeLexer = (text) => {
  const found: Range[] = []
  const lower = text.toLowerCase()
  const n = text.length
  let i = 0
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4)
      const end = close === -1 ? n : close + 3
      found.push({ start: i, end })
      i = end
      continue
    }
    if (text[i] !== '<' || !TAG_START.test(text[i + 1] ?? '')) {
      i++
      continue
    }
    const bodyStart = tagEnd(text, i)
    const block = EMBEDDED_BLOCK.exec(lower.slice(i, i + 8))?.[1]
    if (block === undefined) {
      i = bodyStart
      continue
    }
    const close = lower.indexOf(`</${block}`, bodyStart)
    const bodyEnd = close === -1 ? n : close
    const lang = LANG.exec(lower.slice(i, bodyStart))?.[1] ?? (block === 'script' ? 'js' : 'css')
    const lex = EMBEDDED[lang]
    for (const { start, end } of lex === undefined ? [] : lex(text.slice(bodyStart, bodyEnd))) {
      found.push({ start: start + bodyStart, end: end + bodyStart })
    }
    i = bodyEnd
  }
  return found
}

const overlaps = (range: Range, others: readonly Range[]): boolean => others.some((other) => range.start < other.end && other.start < range.end)

const vueRanges: RangeLexer = (text) => {
  const markup = markupRanges(text)
  if (SFC_TAG.test(text)) return markup
  return [...markup, ...jsx(text).filter((range) => !overlaps(range, markup))]
}

export const lexMarkup = commentLexer(markupRanges)

export const lexVue = commentLexer(vueRanges)
