const BOM = '﻿'

const isWhitespace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r'

const blank = (text: string): string => text.replace(/[^\n]/g, ' ')

const skipString = (text: string, start: number): number => {
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') return index + 1
    index++
  }
  return index
}

const commentEnd = (text: string, start: number): number | undefined => {
  const next = text[start + 1]
  if (next === '/') {
    const newline = text.indexOf('\n', start)
    return newline === -1 ? text.length : newline
  }
  if (next === '*') {
    const close = text.indexOf('*/', start + 2)
    if (close === -1) throw new SyntaxError('unterminated block comment')
    return close + 2
  }
  return undefined
}

const stripComments = (text: string): string => {
  let output = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      const end = skipString(text, index)
      output += text.slice(index, end)
      index = end
      continue
    }
    const end = char === '/' ? commentEnd(text, index) : undefined
    if (end !== undefined) {
      output += blank(text.slice(index, end))
      index = end
      continue
    }
    output += char
    index++
  }
  return output
}

const stripTrailingCommas = (text: string): string => {
  const chars = text.split('')
  let index = 0
  while (index < chars.length) {
    const char = chars[index]
    if (char === '"') {
      index = skipString(text, index)
      continue
    }
    if (char === ',') {
      let next = index + 1
      while (isWhitespace(chars[next])) next++
      const isTrailing = chars[next] === '}' || chars[next] === ']'
      if (isTrailing) {
        chars[index] = ' '
      }
    }
    index++
  }
  return chars.join('')
}

export const parseJsonc = (text: string): unknown => {
  const source = text.startsWith(BOM) ? text.slice(1) : text
  return JSON.parse(stripTrailingCommas(stripComments(source)))
}
