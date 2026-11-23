import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../../core/git'
import type { Json } from '../../core/validator'
import { isSourceFile, isTestFile, location, parseRoles, sizesInCode, type CodeColors, type CodeFile } from './code'
import { hexOf, layoutOf, normText, textOf, textStyleOf, type FigmaExport, type FigmaNode } from './export'

export interface MockupInput {
  root: string
  exportName: string
  exported: FigmaExport
  componentId: string
  code: readonly CodeFile[]
  colors: CodeColors
  roles: readonly string[]
  isAppUi: boolean
  base: string
  paths: readonly string[]
}

export interface Counts {
  missing: number
  extra: number
  notInMockup: number
  duplicate: number
  typography: number
  wrongNode: number
}

export interface MockupReport {
  lines: string[]
  counts: Counts
  blocking: number
}

const LIBRARY_UI_SHARE = 0.3
const NEAR = 4
const UI_KEY = /\b(label|title|text|placeholder|tooltip|caption|header|heading|description|hint)\s*[:=]\s*$/i

const FAIL_LINES = [
  'FAIL. The mockup is the source of truth for the whole component, not only for the part the task names.',
  '  MISSING: set the code to the mockup value.',
  '  UNMAPPED, NOT FOUND, TYPO (typography): map every text role with --role, then set each font size default to the mockup.',
  '  WRONG NODE: check the component drawn on the canvas, not the app UI around it.',
  '  NOT IN MOCKUP, DUPLICATE: the mockup has no such control. Make the control that already exists do the job instead of adding one; renaming a label does not clear the line.',
  "  A deviation that has to stay is the user's decision: ask, do not settle it yourself.",
  'EXTRA lines are for review only: a color of a state the mockup does not draw (hover, tooltip) may stay.',
]
const PASS_LINE = 'PASS. EXTRA lines are for review only: a color of a state the mockup does not draw (hover, tooltip) may stay.'

const text = (value: unknown, fallback = ''): string => (value === undefined || value === null ? fallback : String(value))

const subtreeOf = (nodes: readonly FigmaNode[], rootIndex: number): FigmaNode[] => {
  const root = nodes[rootIndex]
  if (root === undefined) return []
  const out: FigmaNode[] = []
  for (let at = rootIndex + 1; at < nodes.length && (nodes[at]?.depth ?? 0) > root.depth; at++) out.push(nodes[at] as FigmaNode)
  return out
}

const sampleTexts = (list: readonly FigmaNode[], max = 4): string[] => [...new Set(list.map(textOf).filter(Boolean))].slice(0, max)

const libraryShare = (list: readonly FigmaNode[]): number =>
  list.filter((node) => node.type === 'INSTANCE' || node.props['componentId'] || node.id.startsWith('I')).length / Math.max(1, list.length)

const rgbOf = (hex: string): number[] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))

const isNear = (a: string, b: string): boolean => {
  const [r, g, bl] = rgbOf(a)
  const [r2, g2, b2] = rgbOf(b)
  return Math.max(Math.abs((r ?? 0) - (r2 ?? 0)), Math.abs((g ?? 0) - (g2 ?? 0)), Math.abs((bl ?? 0) - (b2 ?? 0))) <= NEAR
}

export const listTopNodes = (exported: FigmaExport): string[] => {
  const { nodes } = exported
  const lines = ['Top nodes of the frame (pass the component with --component <id>):']
  for (const node of nodes.filter((entry) => entry.depth === 1)) {
    const own = subtreeOf(nodes, nodes.indexOf(node))
    const texts = sampleTexts(own, 3).map((sample) => JSON.stringify(sample)).join(', ')
    const kind = own.length >= 10 ? (libraryShare(own) > LIBRARY_UI_SHARE ? '  [app UI from library instances]' : '  [drawn shapes: a scene component?]') : ''
    lines.push(`  ${node.id}  ${node.type}${node.name === '' ? '' : ` "${node.name}"`}  ${own.length} nodes  ${texts}${kind}`)
  }
  return lines
}

interface Context {
  input: MockupInput
  nodes: readonly FigmaNode[]
  rootIndex: number
  comp: readonly FigmaNode[]
  variants: readonly FigmaNode[]
  counts: Counts
}

const describeNode = (input: MockupInput, node: FigmaNode): string => {
  const dimensions = layoutOf(input.exported, node)['dimensions']
  const d: Json = typeof dimensions === 'object' && dimensions !== null ? (dimensions as Json) : {}
  const size = d['width'] != null || d['height'] != null ? ` ${text(d['width'], '?')}×${text(d['height'], '?')}` : ''
  const sample = textOf(node)
  return `${node.type}${node.name === '' ? '' : ` "${node.name}"`}${sample === '' ? size : ` ${JSON.stringify(sample)}`}`
}

const colorsSection = (ctx: Context): string[] => {
  const { input, comp, counts } = ctx
  const { exported } = input
  const mockColors = new Map<string, { uses: number; roles: Map<string, number> }>()
  const addColor = (hex: string, role: string, node: FigmaNode): void => {
    const entry = mockColors.get(hex) ?? { uses: 0, roles: new Map<string, number>() }
    entry.uses++
    const key = `${role} ${describeNode(input, node)}`
    entry.roles.set(key, (entry.roles.get(key) ?? 0) + 1)
    mockColors.set(hex, entry)
  }
  for (const node of comp) {
    for (const hex of hexOf(exported.resolveVar(node.props['fills']))) addColor(hex, node.type === 'TEXT' ? 'text' : 'fill', node)
    for (const hex of hexOf(exported.resolveVar(node.props['strokes']))) addColor(hex, `stroke ${text(node.props['strokeWeight'])}`.trim(), node)
  }
  const out = ['', '## colors (mockup component → code)']
  const codeColors = input.colors.colors
  const nearest = (hex: string): { hex: string; where: string[] } | null => {
    for (const [other, where] of codeColors) if (isNear(hex, other)) return { hex: other, where }
    return null
  }
  for (const [hex, entry] of [...mockColors].sort((a, b) => b[1].uses - a[1].uses)) {
    const base = hex.split(' ')[0] ?? hex
    const exact = codeColors.get(base)
    const near = exact === undefined ? nearest(base) : null
    const where = exact ?? near?.where
    if (where === undefined) counts.missing++
    const roles = [...entry.roles]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([role, count]) => `${role}${count > 1 ? ` ×${count}` : ''}`)
      .join('; ')
    const tag = exact !== undefined ? 'ok     ' : near !== null ? `≈${near.hex}` : 'MISSING'
    const source = where === undefined ? '' : `  ← ${where.slice(0, 2).join(', ')}${where.length > 2 ? ` +${where.length - 2}` : ''}`
    out.push(`${tag} ${hex.padEnd(8)} ${String(entry.uses).padStart(3)} uses: ${roles}${source}`)
  }
  out.push('', '## extra colors (code → not in the mockup component)')
  const mockBases = [...mockColors.keys()].map((hex) => hex.split(' ')[0] ?? hex)
  for (const [hex, where] of codeColors) {
    if (mockBases.some((mock) => isNear(hex, mock))) continue
    counts.extra++
    out.push(`EXTRA   ${hex}  ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` +${where.length - 3}` : ''}`)
  }
  if (counts.extra === 0) out.push('none')
  return out
}

const typographySection = (ctx: Context): string[] => {
  const { input, comp, counts } = ctx
  const { exported } = input
  const groups = new Map<string, FigmaNode[]>()
  for (const node of comp) {
    if (node.type !== 'TEXT') continue
    const style = textStyleOf(exported, node)
    if (style === null) continue
    const lineHeight = style['lineHeight'] ? ` lh ${text(style['lineHeight'])}` : ''
    const textCase = style['textCase'] ? ` ${text(style['textCase'])}` : ''
    const key = `${text(style['fontFamily'], '?')} ${text(style['fontWeight'] ?? style['fontStyle'])} ${text(style['fontSize'], '?')}px${lineHeight}${textCase} ${hexOf(exported.resolveVar(node.props['fills'])).join(',')}`
    groups.set(key, [...(groups.get(key) ?? []), node])
  }
  const roles = parseRoles(input.roles, normText)
  const out = ['', '## typography (mockup component)']
  for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const first = list[0]
    const size = first === undefined ? undefined : textStyleOf(exported, first)?.['fontSize']
    const texts = [...new Set(list.map(textOf).filter(Boolean))]
    const role = roles.find((candidate) => texts.some((sample) => normText(sample) === candidate.sample))
    let verdict: string
    if (role === undefined) {
      counts.typography++
      verdict = 'UNMAPPED'
    } else {
      const hits = sizesInCode(input.code, role)
      const wrong = hits.filter((hit) => hit.size !== size)
      if (hits.length === 0) {
        counts.typography++
        verdict = `NOT FOUND ${role.key}`
      } else if (wrong.length > 0) {
        counts.typography++
        verdict = `TYPO ${role.key} = ${wrong.map((hit) => `${hit.size} at ${hit.where}`).join(', ')}; mockup ${text(size)}`
      } else {
        verdict = `ok ${role.key} ← ${hits.slice(0, 2).map((hit) => hit.where).join(', ')}`
      }
    }
    out.push(`${key.padEnd(44)} ${String(list.length).padStart(3)} ×  ${texts.slice(0, 5).map((sample) => JSON.stringify(sample)).join(', ')}  ${verdict}`)
  }
  if (counts.typography > 0) {
    out.push(`Each UNMAPPED row needs --role "<one of its texts>=[<file>:]<code key of that text's font size>"; NOT FOUND and TYPO rows need the code default set to the mockup size.`)
  }
  return out
}

const geometrySection = (ctx: Context): string[] => {
  const { input, nodes, comp, variants } = ctx
  const { exported } = input
  const first = variants[0]
  const out = ['', `## geometry (first child ${first?.id ?? '-'}, and shapes outside it)`]
  const firstVariant = first === undefined ? [] : subtreeOf(nodes, nodes.indexOf(first))
  const shapeKey = (node: FigmaNode): string => {
    const dimensions = layoutOf(exported, node)['dimensions']
    const d: Json = typeof dimensions === 'object' && dimensions !== null ? (dimensions as Json) : {}
    const fill = hexOf(exported.resolveVar(node.props['fills'])).join(',')
    const stroke = hexOf(exported.resolveVar(node.props['strokes'])).join(',')
    const radius = node.props['borderRadius']
    const hasRadius = typeof radius === 'string' && radius !== '' && !/^0px( 0px)*$/.test(radius)
    return `${node.type} ${text(d['width'], '?')}×${text(d['height'], '?')}${fill ? ` fill ${fill}` : ''}${stroke ? ` stroke ${stroke} ${text(node.props['strokeWeight'])}` : ''}${hasRadius ? ` radius ${radius}` : ''}${node.props['opacity'] != null ? ` opacity ${text(node.props['opacity'])}` : ''}`
  }
  const outside = comp.filter((node) => !firstVariant.includes(node) && !variants.includes(node) && node.type !== 'TEXT' && node.type !== 'GROUP' && node.type !== 'FRAME')
  const shapes = new Map<string, number>()
  for (const node of [...firstVariant.filter((entry) => entry.type !== 'TEXT' && entry.type !== 'GROUP'), ...outside]) {
    const key = shapeKey(node)
    shapes.set(key, (shapes.get(key) ?? 0) + 1)
  }
  for (const [key, count] of shapes) out.push(`${key}${count > 1 ? `  ×${count}` : ''}`)
  return out
}

interface AddedLine {
  file: string
  text: string
}

const pathspec = (paths: readonly string[]): string[] => (paths.length > 0 ? ['--', ...paths] : [])

const addedLines = (root: string, base: string, paths: readonly string[]): AddedLine[] => {
  const added: AddedLine[] = []
  const diff = git(['-c', 'core.quotePath=false', 'diff', '--unified=0', '--no-color', base, ...pathspec(paths)], root)
  let current: string | null = null
  for (const line of diff.stdout.split('\n')) {
    if (line.startsWith('+++ ')) current = line.slice(6)
    else if (line.startsWith('+') && current !== null && !isTestFile(current)) added.push({ file: current, text: line.slice(1) })
  }
  const untracked = git(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', ...pathspec(paths)], root)
  for (const file of untracked.stdout.split('\n').filter((entry) => isSourceFile(entry) && !isTestFile(entry))) {
    for (const line of readFileSync(join(root, file), 'utf8').split(/\r?\n/)) added.push({ file, text: line })
  }
  return added
}

const baseCodeOf = (root: string, base: string, paths: readonly string[], code: readonly CodeFile[]): CodeFile[] => {
  const deleted = git(['-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=D', base, ...pathspec(paths)], root)
  const files = [...code.map((entry) => entry.file), ...deleted.stdout.split('\n').filter((file) => file !== '' && !isTestFile(file))]
  return files.map((file) => {
    const shown = git(['show', `${base}:${file}`], root)
    return { file, lines: shown.ok ? shown.stdout.split(/\r?\n/) : [] }
  })
}

const occurrences = (label: string, source: readonly CodeFile[]): string[] => {
  const hits: string[] = []
  const quoted = new RegExp(`(['"\`])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`)
  for (const { file, lines } of source) lines.forEach((line, index) => { if (quoted.test(line)) hits.push(location(file, index)) })
  return hits
}

const labelsSection = (ctx: Context): string[] => {
  const { input, nodes, counts } = ctx
  const out = ['', '## labels the change adds']
  const added = addedLines(input.root, input.base, input.paths)
  const baseCode = baseCodeOf(input.root, input.base, input.paths, input.code)
  const mockTexts = nodes.map(textOf).filter(Boolean).map((sample) => normText(sample.replace(/\{\/?\w+\}|\*\*/g, '')))
  const inMockup = (label: string): boolean => {
    const wanted = normText(label)
    return mockTexts.some((sample) => sample === wanted || ` ${sample} `.includes(` ${wanted} `))
  }
  const labels = new Map<string, string>()
  for (const { file, text: line } of added) {
    for (const match of line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      const label = match[2] ?? ''
      if (label === '' || label.includes('${') || label.length < 2) continue
      const isUi = /[а-яё]/i.test(label) || UI_KEY.test(line.slice(0, match.index ?? 0))
      if (!isUi || /^[#.\/@]|^[\w.-]+\.[a-z]{2,4}$/.test(label)) continue
      if (!labels.has(label)) labels.set(label, file)
    }
  }
  let kept = 0
  for (const [label, file] of labels) {
    const after = occurrences(label, input.code)
    const before = occurrences(label, baseCode).length
    if (after.length <= before) {
      kept++
      continue
    }
    const notIn = before === 0 && !inMockup(label)
    const duplicate = after.length > 1
    if (notIn) counts.notInMockup++
    if (duplicate) counts.duplicate++
    const tags = [notIn && 'NOT IN MOCKUP', duplicate && 'DUPLICATE'].filter(Boolean).join(' + ') || 'ok'
    out.push(`${tags.padEnd(13)} ${JSON.stringify(label)}  ${duplicate ? `now ${after.length}×, was ${before}×: ${after.slice(0, 4).join(', ')}` : file}`)
  }
  if (kept > 0) out.push(`(${kept} strings on changed lines stand in the code no more often than before)`)
  if (labels.size === 0) out.push(`none (diff against ${input.base.slice(0, 12)})`)
  return out
}

export type MockupResult = { type: 'unknown-node' } | { type: 'report'; report: MockupReport }

export const buildReport = (input: MockupInput): MockupResult => {
  const { nodes } = input.exported
  const rootIndex = nodes.findIndex((node) => node.id === input.componentId)
  const root = nodes[rootIndex]
  if (root === undefined) return { type: 'unknown-node' }
  const comp = subtreeOf(nodes, rootIndex)
  const variants = nodes.filter((node, at) => at > rootIndex && node.depth === root.depth + 1 && at <= rootIndex + comp.length)
  const counts: Counts = { missing: 0, extra: 0, notInMockup: 0, duplicate: 0, typography: 0, wrongNode: 0 }
  const ctx: Context = { input, nodes, rootIndex, comp, variants, counts }
  const out = [`# ui mockup ${input.exportName} ${root.id}${root.name === '' ? '' : ` "${root.name}"`}: ${comp.length} nodes, ${variants.length} children`]
  if (!input.isAppUi && libraryShare(comp) > LIBRARY_UI_SHARE) {
    counts.wrongNode++
    out.push(
      `WRONG NODE: ${Math.round(libraryShare(comp) * 100)}% of this node is library instances, so it is app UI (a panel, a toolbar), not the component drawn on the canvas. Pick the node of the component itself from the list without --component; pass --ui only when the task is that app UI.`,
    )
  }
  for (const variant of variants.slice(0, 12)) {
    const texts = sampleTexts(subtreeOf(nodes, nodes.indexOf(variant)).concat(variant), 3).map((sample) => JSON.stringify(sample)).join(', ')
    out.push(`  ${variant.id} ${describeNode(input, variant)}${texts === '' ? '' : `  ${texts}`}`)
  }
  out.push(...colorsSection(ctx), ...typographySection(ctx), ...geometrySection(ctx), ...labelsSection(ctx))
  out.push('', `summary: ${counts.missing} MISSING, ${counts.extra} EXTRA, ${counts.notInMockup} NOT IN MOCKUP, ${counts.duplicate} DUPLICATE, ${counts.typography} TYPOGRAPHY${counts.wrongNode > 0 ? ', WRONG NODE' : ''}`)
  const blocking = counts.missing + counts.notInMockup + counts.duplicate + counts.typography + counts.wrongNode
  out.push(...(blocking > 0 ? FAIL_LINES : [PASS_LINE]))
  return { type: 'report', report: { lines: out, counts, blocking } }
}

