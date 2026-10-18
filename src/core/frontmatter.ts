export type FrontmatterMap = Readonly<Record<string, string>>

export type FrontmatterValue = string | string[] | FrontmatterMap

export interface Frontmatter {
  data: Record<string, FrontmatterValue>
  body: string
  bodyLine: number
}

export class FrontmatterError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`)
    this.name = 'FrontmatterError'
  }
}

const FENCE = '---'
const KEY_LINE = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/
const LIST_ITEM = /^\s*-\s+(.*)$/
const MAP_ENTRY = /^(\s+)([A-Za-z_][\w-]*):(?:\s+(.*))?$/
const DOUBLE_QUOTE_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', n: '\n', t: '\t', r: '\r', '0': '\0' }

interface Cursor {
  text: string
  index: number
  line: number
}

const fail = (cursor: Cursor, message: string): never => {
  throw new FrontmatterError(message, cursor.line)
}

const readDoubleQuoted = (cursor: Cursor): string => {
  const { text } = cursor
  let value = ''
  let index = cursor.index + 1
  while (index < text.length) {
    const char = text[index] ?? ''
    if (char === '"') {
      cursor.index = index + 1
      return value
    }
    if (char !== '\\') {
      value += char
      index++
      continue
    }
    const escape = text[index + 1] ?? ''
    if (escape === 'u') {
      const hex = text.slice(index + 2, index + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(cursor, `invalid escape \\u${hex}`)
      value += String.fromCharCode(Number.parseInt(hex, 16))
      index += 6
      continue
    }
    value += DOUBLE_QUOTE_ESCAPES[escape] ?? fail(cursor, `invalid escape \\${escape}`)
    index += 2
  }
  return fail(cursor, 'unterminated double-quoted string')
}

const readSingleQuoted = (cursor: Cursor): string => {
  const { text } = cursor
  let value = ''
  let index = cursor.index + 1
  while (index < text.length) {
    const char = text[index] ?? ''
    if (char !== "'") {
      value += char
      index++
      continue
    }
    if (text[index + 1] === "'") {
      value += "'"
      index += 2
      continue
    }
    cursor.index = index + 1
    return value
  }
  return fail(cursor, 'unterminated single-quoted string')
}

const skipSpaces = (cursor: Cursor): void => {
  while (cursor.text[cursor.index] === ' ' || cursor.text[cursor.index] === '\t') cursor.index++
}

const isRestEmpty = (cursor: Cursor): boolean => {
  skipSpaces(cursor)
  const rest = cursor.text.slice(cursor.index)
  return rest === '' || rest.startsWith('#')
}

const stripPlainComment = (text: string): string => {
  const match = /(^|\s)#/.exec(text)
  return (match ? text.slice(0, match.index) : text).trim()
}

const readFlowItem = (cursor: Cursor): string => {
  const char = cursor.text[cursor.index]
  if (char === '"') return readDoubleQuoted(cursor)
  if (char === "'") return readSingleQuoted(cursor)
  const rest = cursor.text.slice(cursor.index)
  const match = /^[^,\]]*/.exec(rest)
  const raw = match?.[0] ?? ''
  cursor.index += raw.length
  const value = raw.trim()
  if (value === '') fail(cursor, 'empty array item')
  return value
}

const readFlowArray = (cursor: Cursor): string[] => {
  const items: string[] = []
  cursor.index++
  skipSpaces(cursor)
  if (cursor.text[cursor.index] === ']') {
    cursor.index++
    return items
  }
  while (cursor.index < cursor.text.length) {
    skipSpaces(cursor)
    items.push(readFlowItem(cursor))
    skipSpaces(cursor)
    const separator = cursor.text[cursor.index]
    cursor.index++
    if (separator === ']') return items
    if (separator !== ',') fail(cursor, 'expected "," or "]" in array')
  }
  return fail(cursor, 'unterminated array')
}

const readInlineValue = (cursor: Cursor): string | string[] => {
  const char = cursor.text[cursor.index]
  const isQuoted = char === '"' || char === "'"
  const isArray = char === '['
  if (!isQuoted && !isArray) return stripPlainComment(cursor.text.slice(cursor.index))
  const value = isArray ? readFlowArray(cursor) : readFlowItem(cursor)
  if (!isRestEmpty(cursor)) fail(cursor, 'unexpected text after value')
  return value
}

const readScalar = (text: string, line: number): string => {
  const cursor: Cursor = { text, index: 0, line }
  const value = readInlineValue(cursor)
  if (Array.isArray(value)) return fail(cursor, 'nested arrays are not supported')
  return value
}

const isSkippable = (line: string): boolean => line.trim() === '' || line.trimStart().startsWith('#')

interface BlockValue {
  value: FrontmatterValue
  next: number
}

const readList = (lines: string[], from: number, firstLine: number): BlockValue => {
  const items: string[] = []
  let index = from
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const item = LIST_ITEM.exec(line)
    if (!item && !isSkippable(line)) break
    index++
    if (item) items.push(readScalar(item[1] ?? '', firstLine + index - 1))
  }
  return { value: items, next: index }
}

const readMap = (lines: string[], from: number, firstLine: number, indent: string): BlockValue => {
  const map: Record<string, string> = {}
  let index = from
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const entry = MAP_ENTRY.exec(line)
    if (!entry && !isSkippable(line)) break
    index++
    if (!entry) continue
    const cursor: Cursor = { text: line, index: 0, line: firstLine + index - 1 }
    const key = entry[2] ?? ''
    const inline = entry[3]?.trim() ?? ''
    if (entry[1] !== indent) fail(cursor, `inconsistent indentation before "${key}"`)
    if (Object.hasOwn(map, key)) fail(cursor, `duplicate key "${key}"`)
    if (inline === '' || inline.startsWith('#')) fail(cursor, `"${key}" needs a string value`)
    map[key] = readScalar(inline, cursor.line)
  }
  return { value: map, next: index }
}

const readBlockValue = (lines: string[], from: number, firstLine: number): BlockValue => {
  const first = lines.slice(from).find((line) => !isSkippable(line)) ?? ''
  if (LIST_ITEM.test(first)) return readList(lines, from, firstLine)
  const entry = MAP_ENTRY.exec(first)
  if (entry) return readMap(lines, from, firstLine, entry[1] ?? '')
  return { value: '', next: from }
}

const parseBlock = (lines: string[], firstLine: number): Record<string, FrontmatterValue> => {
  const data: Record<string, FrontmatterValue> = {}
  let index = 0
  while (index < lines.length) {
    const lineNumber = firstLine + index
    const line = lines[index] ?? ''
    index++
    if (isSkippable(line)) continue
    const match = KEY_LINE.exec(line)
    const cursor: Cursor = { text: line, index: 0, line: lineNumber }
    if (!match) fail(cursor, `expected "key: value", got "${line}"`)
    const key = match?.[1] ?? ''
    const inline = match?.[2]?.trim() ?? ''
    if (Object.hasOwn(data, key)) fail(cursor, `duplicate key "${key}"`)
    const hasInlineValue = inline !== '' && !inline.startsWith('#')
    if (hasInlineValue) {
      data[key] = readInlineValue({ text: inline, index: 0, line: lineNumber })
      continue
    }
    const block = readBlockValue(lines, index, firstLine)
    data[key] = block.value
    index = block.next
  }
  return data
}

export const parseFrontmatter = (text: string): Frontmatter | undefined => {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trimEnd() !== FENCE) return undefined
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE)
  if (closing === -1) throw new FrontmatterError('missing closing "---"', lines.length)
  const data = parseBlock(lines.slice(1, closing), 2)
  return { data, body: lines.slice(closing + 1).join('\n'), bodyLine: closing + 2 }
}
