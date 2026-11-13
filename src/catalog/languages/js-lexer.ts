import { blockEnd, commentLexer, lineEnd, skipQuoted, WORD, type Range, type RangeLexer } from './lexer'

const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])
const TYPE_PARAMETERS = /^<\s*(?:const\s+)?[\p{L}_$][\p{L}\p{N}_$]*\s*(?:extends\b|[,=])/u
const JSX_START = /[\p{L}_$>]/u

export const jsRanges =
  (jsx: boolean): RangeLexer =>
  (text) => {
    const found: Range[] = []
    const n = text.length
    let i = 0
    const comment = (end: number): void => {
      found.push({ start: i, end })
      i = end
    }
    const regex = (): void => {
      let inClass = false
      i++
      while (i < n && text[i] !== '\n') {
        const c = text[i]
        if (c === '\\') {
          i += 2
          continue
        }
        i++
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) break
      }
      while (i < n && /[a-z]/i.test(text[i] ?? '')) i++
    }
    const hole = (): void => {
      i++
      code(true)
      i++
    }
    const template = (): void => {
      i++
      while (i < n) {
        const c = text[i]
        if (c === '\\') i += 2
        else if (c === '`') {
          i++
          return
        } else if (c === '$' && text[i + 1] === '{') {
          i++
          hole()
        } else i++
      }
    }
    const tag = (): boolean => {
      while (i < n) {
        const c = text[i]
        const d = text[i + 1]
        if (c === '/' && d === '>') {
          i += 2
          return true
        }
        if (c === '>') {
          i++
          return false
        }
        if (c === '/' && d === '/') comment(lineEnd(text, i))
        else if (c === '/' && d === '*') comment(blockEnd(text, i))
        else if (c === '"' || c === "'") i = skipQuoted(text, i, c, false, true)
        else if (c === '{') hole()
        else i++
      }
      return false
    }
    const element = (): void => {
      let depth = 0
      while (i < n) {
        i++
        const closing = text[i] === '/'
        const selfClosing = tag()
        depth += closing ? -1 : selfClosing ? 0 : 1
        if (depth <= 0) return
        while (i < n && text[i] !== '<') {
          if (text[i] === '{') hole()
          else i++
        }
      }
    }
    const code = (braced: boolean): void => {
      let depth = 0
      let operand = true
      while (i < n) {
        const c = text[i] ?? ''
        const d = text[i + 1] ?? ''
        if (c === '/' && d === '/') comment(lineEnd(text, i))
        else if (c === '/' && d === '*') comment(blockEnd(text, i))
        else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++
        else if (c === '"' || c === "'") {
          i = skipQuoted(text, i, c)
          operand = false
        } else if (c === '`') {
          template()
          operand = false
        } else if (c === '/') {
          if (operand) regex()
          else i++
          operand = !operand
        } else if (c === '<' && jsx && operand && JSX_START.test(d) && !TYPE_PARAMETERS.test(text.slice(i, i + 64))) {
          element()
          operand = false
        } else if (c === '{') {
          depth++
          i++
          operand = true
        } else if (c === '}') {
          if (braced && depth === 0) return
          depth--
          i++
          operand = true
        } else if (WORD.test(c)) {
          const start = i
          while (i < n && WORD.test(text[i] ?? '')) i++
          operand = REGEX_AFTER.has(text.slice(start, i))
        } else {
          i++
          operand = c !== ')' && c !== ']'
        }
      }
    }
    code(false)
    return found
  }

export const lexJs = commentLexer(jsRanges(true))

export const lexTs = commentLexer(jsRanges(false))
