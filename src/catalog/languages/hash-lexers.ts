import { commentLexer, lineEnd, skipQuoted, type Range } from './lexer'

interface Heredoc {
  tag: string
  strip: boolean
}

const HEREDOC = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/
const SHELL_COMMENT_AFTER = /[\s;&|()]/

const pythonRanges = (text: string): Range[] => {
  const found: Range[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i] ?? ''
    if (c === '#') {
      const end = lineEnd(text, i)
      found.push({ start: i, end })
      i = end
    } else if (c === '"' || c === "'") {
      const triple = c.repeat(3)
      if (!text.startsWith(triple, i)) {
        i = skipQuoted(text, i, c)
        continue
      }
      i += 3
      while (i < n && !text.startsWith(triple, i)) i += text[i] === '\\' ? 2 : 1
      i += 3
    } else i++
  }
  return found
}

const skipHeredoc = (text: string, from: number, { tag, strip }: Heredoc): number => {
  let i = from
  while (i < text.length) {
    const end = lineEnd(text, i)
    const line = text.slice(i, end).replace(/\r$/, '')
    if ((strip ? line.replace(/^\t+/, '') : line) === tag) return end + 1
    i = end + 1
  }
  return text.length
}

const shellRanges = (text: string): Range[] => {
  const found: Range[] = []
  const pending: Heredoc[] = []
  const n = text.length
  let arithmetic = 0
  let i = 0
  while (i < n) {
    const c = text[i]
    if (c === '\n') {
      i++
      for (let heredoc = pending.shift(); heredoc !== undefined; heredoc = pending.shift()) i = skipHeredoc(text, i, heredoc)
    } else if (c === '#' && (i === 0 || SHELL_COMMENT_AFTER.test(text[i - 1] ?? ''))) {
      const end = lineEnd(text, i)
      found.push({ start: i, end })
      i = end
    } else if (c === '\\') i += 2
    else if (c === "'") i = skipQuoted(text, i, "'", text[i - 1] === '$', true)
    else if (c === '"') i = skipQuoted(text, i, '"', true, true)
    else if (c === '(' && text[i + 1] === '(') {
      arithmetic++
      i += 2
    } else if (c === ')' && text[i + 1] === ')' && arithmetic > 0) {
      arithmetic--
      i += 2
    } else if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<' && arithmetic === 0) {
      const heredoc = HEREDOC.exec(text.slice(i, i + 200))
      if (heredoc !== null) pending.push({ tag: heredoc[3] ?? '', strip: heredoc[1] === '-' })
      i += heredoc === null ? 2 : heredoc[0].length
    } else i++
  }
  return found
}

export const lexPython = commentLexer(pythonRanges)

export const lexShell = commentLexer(shellRanges)
