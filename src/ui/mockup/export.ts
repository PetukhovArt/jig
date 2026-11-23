import { isObject, type Json } from '../../core/validator'

export interface FigmaNode {
  depth: number
  type: string
  name: string
  id: string
  props: Json
}

export interface FigmaExport {
  nodes: FigmaNode[]
  resolveVar: (ref: unknown) => unknown
}

interface Line {
  indent: number
  text: string
}

const NODES_SECTION = /^NODES:\s*$/m
const NODE_LINE = /^(\s*)\[([A-Z-]+)\](?: "((?:[^"\\]|\\.)*)")? #(\S+)(.*)$/

export const hasNodes = (source: string): boolean => NODES_SECTION.test(source)

const parseScalar = (raw: string): unknown => {
  const value = raw.trim()
  if (value === '{}') return {}
  if (value === '[]') return []
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'")
  if (/^".*"$/.test(value)) return JSON.parse(value)
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true' || value === 'false') return value === 'true'
  return value
}

const parseYamlBlock = (lines: readonly string[]): Json => {
  const items: Line[] = lines
    .map((line) => ({ indent: line.search(/\S/), text: line.trim() }))
    .filter((line) => line.indent >= 0 && !line.text.startsWith('#'))
  let at = 0
  const block = (indent: number): unknown => {
    const first = items[at]
    if (first === undefined) return null
    if (first.text.startsWith('- ')) {
      const list: unknown[] = []
      for (let item = items[at]; item !== undefined && item.indent === indent && item.text.startsWith('- '); item = items[at]) {
        list.push(parseScalar(item.text.slice(2)))
        at++
      }
      return list
    }
    const map: Json = {}
    for (let item = items[at]; item !== undefined && item.indent === indent; item = items[at]) {
      const { text } = item
      at++
      if (text.endsWith(':')) {
        const next = items[at]
        const hasChild = next !== undefined && (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))
        map[text.slice(0, -1)] = hasChild ? block(next.indent) : null
      } else {
        const colon = text.indexOf(': ')
        if (colon < 0) continue
        map[text.slice(0, colon)] = parseScalar(text.slice(colon + 2))
      }
    }
    return map
  }
  const root: Json = {}
  while (at < items.length) {
    const before = at
    const first = items[at]
    if (first !== undefined) {
      const parsed = block(first.indent)
      if (isObject(parsed)) Object.assign(root, parsed)
    }
    if (at === before) at++
  }
  return root
}

const closingBrace = (text: string, from: number): number => {
  let depth = 0
  let inString = false
  let at = from
  for (; at < text.length; at++) {
    const char = text[at]
    if (inString) {
      if (char === '\\') at++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) break
  }
  return at
}

const parseAttrs = (text: string): Json => {
  const attrs: Json = {}
  let at = 0
  while (at < text.length) {
    const found = /^\s*([A-Za-z]+)=/.exec(text.slice(at))
    if (found === null) break
    at += found[0].length
    const key = found[1] ?? ''
    if (text[at] === '{') {
      const end = closingBrace(text, at)
      try {
        attrs[key] = JSON.parse(text.slice(at, end + 1))
      } catch {
        attrs[key] = text.slice(at, end + 1)
      }
      at = end + 1
    } else if (text[at] === '"') {
      let end = at + 1
      for (; end < text.length; end++) {
        if (text[end] === '\\') end++
        else if (text[end] === '"') break
      }
      try {
        attrs[key] = JSON.parse(text.slice(at, end + 1))
      } catch {
        attrs[key] = text.slice(at + 1, end)
      }
      at = end + 1
    } else {
      const space = text.indexOf(' ', at)
      const end = space < 0 ? text.length : space
      attrs[key] = parseScalar(text.slice(at, end))
      at = end
    }
  }
  return attrs
}

const parseNodes = (lines: readonly string[], elements: Json): FigmaNode[] => {
  const nodes: FigmaNode[] = []
  for (const line of lines) {
    const found = NODE_LINE.exec(line)
    if (found === null) continue
    const inline = parseAttrs(found[5] ?? '')
    const template = typeof inline['template'] === 'string' ? elements[inline['template']] : undefined
    nodes.push({
      depth: (found[1] ?? '').length / 2,
      type: found[2] ?? '',
      name: found[3] ?? '',
      id: found[4] ?? '',
      props: { ...(isObject(template) ? template : {}), ...inline },
    })
  }
  return nodes
}

export const parseExport = (rawSource: string): FigmaExport => {
  const source = rawSource.replace(/\r\n/g, '\n')
  const nodesAt = source.search(NODES_SECTION)
  const head = parseYamlBlock(source.slice(0, nodesAt).split('\n'))
  const pick = (section: string): Json => {
    const value = head[section]
    return isObject(value) ? value : head
  }
  const vars = pick('GLOBAL_VARS')
  const elements = pick('ELEMENTS')
  const nodes = parseNodes(source.slice(nodesAt).split('\n').slice(1), elements)
  const resolveVar = (ref: unknown): unknown => {
    if (ref === undefined || ref === null) return null
    if (typeof ref !== 'string') return ref
    if (ref in vars) return vars[ref]
    const bare = ref.replace(/\s*\([^)]*\)\s*$/, '')
    return bare in vars ? vars[bare] : ref
  }
  return { nodes, resolveVar }
}

const normHex = (raw: string): string => {
  let hex = raw.toUpperCase()
  if (hex.length === 3) hex = hex.split('').map((char) => char + char).join('')
  if (hex.length === 8) hex = hex.slice(0, 6) + (hex.slice(6) === 'FF' ? '' : ` @${(parseInt(hex.slice(6), 16) / 255).toFixed(2)}`)
  return `#${hex}`
}

export { normHex }

export const hexOf = (value: unknown): string[] => {
  const out: string[] = []
  for (const item of [value ?? []].flat()) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)
    if (hex !== null) out.push(normHex(hex[1] ?? ''))
    const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(text)
    if (rgba !== null) {
      const channels = [1, 2, 3].map((index) => Number(rgba[index]).toString(16).padStart(2, '0')).join('').toUpperCase()
      out.push(`#${channels}${rgba[4] !== undefined && rgba[4] !== '1' ? ` @${rgba[4]}` : ''}`)
    }
  }
  return out
}

export const layoutOf = (exported: FigmaExport, node: FigmaNode): Json => {
  const layout = typeof node.props['layout'] === 'string' ? exported.resolveVar(node.props['layout']) : node.props['layout']
  return isObject(layout) ? layout : {}
}

export const textStyleOf = (exported: FigmaExport, node: FigmaNode): Json | null => {
  const style = exported.resolveVar(node.props['textStyle'])
  return isObject(style) ? style : null
}

export const textOf = (node: FigmaNode): string => (typeof node.props['text'] === 'string' ? node.props['text'] : '')

export const normText = (text: string): string => text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
