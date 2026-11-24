import { childPath, required, Validator, type Json } from '../core/validator'

export const NODE_KINDS = ['text', 'shape', 'group', 'instance'] as const
export type NodeKind = (typeof NODE_KINDS)[number]

export interface TreeFont {
  family?: string
  size?: number
  weight?: number
  lineHeight?: number
}

export interface TreeBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface TreeStroke {
  color: string
  weight?: number
}

export interface TreeNode {
  id: string
  name?: string
  kind?: NodeKind
  text?: string
  fill?: string
  stroke?: TreeStroke
  font?: TreeFont
  bounds?: TreeBounds
  radius?: number
  opacity?: number
  children?: TreeNode[]
}

export interface Tree {
  version: 1
  name?: string
  nodes: TreeNode[]
}

export interface FlatNode {
  depth: number
  kind: NodeKind
  id: string
  name: string
  text: string
  fill: string[]
  stroke: { color: string[]; weight?: number }
  font?: TreeFont
  bounds?: TreeBounds
  radius?: number
  opacity?: number
}

const NODE_KEYS = ['id', 'name', 'kind', 'text', 'fill', 'stroke', 'font', 'bounds', 'radius', 'opacity', 'children'] as const
const FONT_KEYS = ['family', 'size', 'weight', 'lineHeight'] as const
const BOUNDS_KEYS = ['x', 'y', 'width', 'height'] as const
const STROKE_KEYS = ['color', 'weight'] as const
const TREE_KEYS = ['$schema', 'version', 'name', 'nodes'] as const

export const normHex = (raw: string): string => {
  let hex = raw.toUpperCase()
  if (hex.length === 3) hex = hex.split('').map((char) => char + char).join('')
  if (hex.length === 8) hex = hex.slice(0, 6) + (hex.slice(6) === 'FF' ? '' : ` @${(parseInt(hex.slice(6), 16) / 255).toFixed(2)}`)
  return `#${hex}`
}

export const hexOf = (value: unknown): string[] => {
  const out: string[] = []
  for (const item of [value ?? []].flat()) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)
    if (hex !== null) out.push(normHex(hex[1] ?? ''))
    const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text)
    if (rgba !== null) {
      const channels = [1, 2, 3].map((index) => Number(rgba[index]).toString(16).padStart(2, '0')).join('').toUpperCase()
      out.push(`#${channels}${rgba[4] !== undefined && rgba[4] !== '1' ? ` @${rgba[4]}` : ''}`)
    }
  }
  return out
}

export const normText = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

const readNumber = (validator: Validator, value: unknown, path: string): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : validator.report(path, 'expected a number')

const readColor = (validator: Validator, value: unknown, path: string): string | undefined => {
  const color = validator.string(value, path)
  if (color === undefined) return undefined
  return hexOf(color).length > 0 ? color : validator.report(path, 'expected a color: #RGB, #RRGGBB, #RRGGBBAA, rgb() or rgba()')
}

const readStroke = (validator: Validator, value: unknown, path: string): TreeStroke | undefined => {
  const object = validator.object(value, path, STROKE_KEYS)
  if (object === undefined || !required(validator, object, path, ['color'])) return undefined
  const color = readColor(validator, object['color'], childPath(path, 'color'))
  const weight = object['weight'] === undefined ? undefined : readNumber(validator, object['weight'], childPath(path, 'weight'))
  return color === undefined ? undefined : { color, ...(weight === undefined ? {} : { weight }) }
}

const readFont = (validator: Validator, value: unknown, path: string): TreeFont | undefined => {
  const object = validator.object(value, path, FONT_KEYS)
  if (object === undefined) return undefined
  const font: TreeFont = {}
  if (object['family'] !== undefined) {
    const family = validator.string(object['family'], childPath(path, 'family'))
    if (family !== undefined) font.family = family
  }
  for (const key of ['size', 'weight', 'lineHeight'] as const) {
    if (object[key] === undefined) continue
    const number = readNumber(validator, object[key], childPath(path, key))
    if (number !== undefined) font[key] = number
  }
  return font
}

const readBounds = (validator: Validator, value: unknown, path: string): TreeBounds | undefined => {
  const object = validator.object(value, path, BOUNDS_KEYS)
  if (object === undefined || !required(validator, object, path, ['width', 'height'])) return undefined
  const numbers: Json = {}
  for (const key of BOUNDS_KEYS) {
    if (object[key] !== undefined) numbers[key] = readNumber(validator, object[key], childPath(path, key))
  }
  return typeof numbers['width'] === 'number' && typeof numbers['height'] === 'number' ? (numbers as unknown as TreeBounds) : undefined
}

const readNode = (validator: Validator, value: unknown, path: string, seen: Set<string>): TreeNode | undefined => {
  const object = validator.object(value, path, NODE_KEYS)
  if (object === undefined || !required(validator, object, path, ['id'])) return undefined
  const at = (key: string): string => childPath(path, key)
  const id = validator.string(object['id'], at('id'))
  if (id === undefined) return undefined
  if (id === '') validator.report(at('id'), 'is empty')
  if (seen.has(id)) validator.report(at('id'), `duplicate id ${id}`)
  seen.add(id)
  const node: TreeNode = { id }
  const name = object['name'] === undefined ? undefined : validator.string(object['name'], at('name'))
  const kind = object['kind'] === undefined ? undefined : validator.oneOf(object['kind'], at('kind'), NODE_KINDS)
  const text = object['text'] === undefined ? undefined : validator.string(object['text'], at('text'))
  const fill = object['fill'] === undefined ? undefined : readColor(validator, object['fill'], at('fill'))
  const radius = object['radius'] === undefined ? undefined : readNumber(validator, object['radius'], at('radius'))
  const opacity = object['opacity'] === undefined ? undefined : readNumber(validator, object['opacity'], at('opacity'))
  const stroke = object['stroke'] === undefined ? undefined : readStroke(validator, object['stroke'], at('stroke'))
  const font = object['font'] === undefined ? undefined : readFont(validator, object['font'], at('font'))
  const bounds = object['bounds'] === undefined ? undefined : readBounds(validator, object['bounds'], at('bounds'))
  let children: TreeNode[] | undefined
  if (object['children'] !== undefined) {
    if (Array.isArray(object['children'])) {
      children = object['children'].flatMap((child, index) => readNode(validator, child, childPath(at('children'), index), seen) ?? [])
    } else {
      validator.report(at('children'), 'expected an array')
    }
  }
  return {
    ...node,
    ...(name === undefined ? {} : { name }),
    ...(kind === undefined ? {} : { kind }),
    ...(text === undefined ? {} : { text }),
    ...(fill === undefined ? {} : { fill }),
    ...(stroke === undefined ? {} : { stroke }),
    ...(font === undefined ? {} : { font }),
    ...(bounds === undefined ? {} : { bounds }),
    ...(radius === undefined ? {} : { radius }),
    ...(opacity === undefined ? {} : { opacity }),
    ...(children === undefined ? {} : { children }),
  }
}

export const parseTree = (text: string): { tree?: Tree; errors: string[] } => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { errors: [`$: not JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const validator = new Validator()
  const object = validator.object(value, '$', TREE_KEYS)
  if (object === undefined || !required(validator, object, '$', ['version', 'nodes'])) return { errors: validator.errors }
  if (object['version'] !== 1) validator.report('$.version', 'expected 1')
  const list = object['nodes']
  if (!Array.isArray(list) || list.length === 0) validator.report('$.nodes', 'expected a non-empty array')
  const seen = new Set<string>()
  const nodes = Array.isArray(list) ? list.flatMap((node, index) => readNode(validator, node, childPath('$.nodes', index), seen) ?? []) : []
  const name = object['name'] === undefined ? undefined : validator.string(object['name'], '$.name')
  if (validator.errors.length > 0) return { errors: validator.errors }
  return { tree: { version: 1, ...(name === undefined ? {} : { name }), nodes }, errors: [] }
}

const kindOf = (node: TreeNode): NodeKind => node.kind ?? (node.text !== undefined ? 'text' : (node.children?.length ?? 0) > 0 ? 'group' : 'shape')

export const flattenTree = (tree: Tree): FlatNode[] => {
  const out: FlatNode[] = []
  const visit = (node: TreeNode, depth: number): void => {
    out.push({
      depth,
      kind: kindOf(node),
      id: node.id,
      name: node.name ?? '',
      text: node.text ?? '',
      fill: hexOf(node.fill),
      stroke: { color: hexOf(node.stroke?.color), ...(node.stroke?.weight === undefined ? {} : { weight: node.stroke.weight }) },
      ...(node.font === undefined ? {} : { font: node.font }),
      ...(node.bounds === undefined ? {} : { bounds: node.bounds }),
      ...(node.radius === undefined ? {} : { radius: node.radius }),
      ...(node.opacity === undefined ? {} : { opacity: node.opacity }),
    })
    node.children?.forEach((child) => visit(child, depth + 1))
  }
  tree.nodes.forEach((node) => visit(node, 0))
  return out
}
