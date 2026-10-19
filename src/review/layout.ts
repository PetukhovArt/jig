import { TIERS, type Tier } from '../tiers/tiers'

export const EFFORTS = ['low', 'medium', 'high'] as const
export type Effort = (typeof EFFORTS)[number]
export const CEILINGS = ['Important', 'Nit'] as const
export type Ceiling = (typeof CEILINGS)[number]

export interface Grade {
  tier: Tier
  effort: Effort
}

export const LINES_PER_FINDER = 150
export const MAX_FINDERS = 5
export const MAX_PARALLEL = 6

export const ANGLE_TOKENS = {
  1: 'bugs',
  2: 'bugs',
  3: 'bugs',
  4: 'bugs',
  5: 'bugs',
  6: 'reuse',
  7: 'simplification',
  8: 'efficiency',
  9: 'altitude',
  10: 'conventions',
  11: 'docs',
  12: 'bugs',
  13: 'architecture',
  14: 'security',
  15: 'spec',
  16: 'tests',
  17: 'comments',
} as const satisfies Record<number, string>

export type Angle = keyof typeof ANGLE_TOKENS
const isAngle = (value: number): value is Angle => Object.hasOwn(ANGLE_TOKENS, value)
export const ANGLES: readonly Angle[] = Object.keys(ANGLE_TOKENS).map(Number).filter(isAngle)

const IMPORTANT_ANGLES: readonly Angle[] = [1, 2, 3, 4, 5, 8, 10, 12, 13, 14, 15]

const TOKEN_ANGLES: Readonly<Record<string, readonly Angle[]>> = {
  bugs: [1, 2, 3, 4, 5, 12],
  security: [14],
  reuse: [6],
  simplification: [7],
  efficiency: [8],
  altitude: [9],
  conventions: [10],
  smells: [10],
  docs: [11],
  adr: [13, 11],
  glossary: [13, 11],
  architecture: [13],
  spec: [15],
  tests: [16],
  comments: [17],
}
const SPECIAL_TOKENS = ['important', 'deepening'] as const
export const SELECTOR_TOKENS = [...SPECIAL_TOKENS, ...Object.keys(TOKEN_ANGLES), 'auto']
const PRESETS: Readonly<Record<string, string | undefined>> = { full: undefined, quick: 'important' }

export const DEFAULT_GRADES: Readonly<Record<string, Grade>> = {
  bugs: { tier: 'deep', effort: 'high' },
  efficiency: { tier: 'standard', effort: 'high' },
  security: { tier: 'standard', effort: 'high' },
  architecture: { tier: 'deep', effort: 'high' },
  spec: { tier: 'deep', effort: 'high' },
  reuse: { tier: 'standard', effort: 'high' },
  conventions: { tier: 'standard', effort: 'high' },
  docs: { tier: 'standard', effort: 'high' },
  altitude: { tier: 'deep', effort: 'high' },
  simplification: { tier: 'standard', effort: 'high' },
  tests: { tier: 'standard', effort: 'medium' },
  comments: { tier: 'standard', effort: 'medium' },
  verify: { tier: 'deep', effort: 'medium' },
  outcome: { tier: 'deep', effort: 'medium' },
  composer: { tier: 'standard', effort: 'medium' },
  deepening: { tier: 'deep', effort: 'high' },
}
export const GRADE_KEYS = Object.keys(DEFAULT_GRADES)

const BUG_GROUPS: Readonly<Record<number, readonly (readonly Angle[])[]>> = {
  1: [[1, 2, 3, 4, 5, 8, 12, 14]],
  2: [
    [1, 4, 8, 14],
    [2, 3, 5, 12],
  ],
  3: [[1, 4, 8, 14], [2, 3], [5, 12]],
  4: [[1, 4, 8], [14], [2, 3], [5, 12]],
}
const MAX_BUG_FINDERS = 4
const CLEANUP: readonly Angle[] = [7, 9]
const RULES: readonly Angle[] = [6, 10, 11, 13, 15]
const MECHANICAL: readonly Angle[] = [16, 17]
const CLEANUP_TOKENS = ['reuse', 'simplification', 'altitude', 'conventions']

export interface Shape {
  tests: boolean
  comments: boolean
  docs: boolean
  newSourceFiles: number
  spec: boolean
}

export interface AngleSettings {
  enabled?: boolean
  severityCeiling?: Ceiling
}

export interface PlanInput {
  lines: number
  shape: Shape
  selector?: string | undefined
  angles?: Readonly<Partial<Record<Angle, AngleSettings>>>
  grades?: Readonly<Record<string, Grade>>
}

export type FinderKind = 'single' | 'bugs' | 'cleanup' | 'rules' | 'mechanical'

export interface Finder extends Grade {
  name: string
  kind: FinderKind
  angles: Angle[]
}

export interface Skipped {
  angle: Angle
  reason: string
}

export interface Selection {
  input: string
  tokens: string[]
}

export interface Plan {
  lines: number
  n: number
  selection: Selection
  outputTokens: string[]
  angles: Angle[]
  skipped: Skipped[]
  finders: Finder[]
  deepening: Grade | undefined
  verify: Grade
  outcome: Grade
  composer: Grade
}

export const finderCount = (lines: number): number => Math.min(MAX_FINDERS, Math.ceil(Math.max(0, lines) / LINES_PER_FINDER))

const ceilingOf = (angle: Angle, settings: PlanInput['angles']): Ceiling =>
  settings?.[angle]?.severityCeiling ?? (IMPORTANT_ANGLES.includes(angle) ? 'Important' : 'Nit')

export const autoTokens = (shape: Shape, n: number): string[] => {
  const tokens = ['important']
  if (shape.tests) tokens.push('tests')
  if (shape.comments) tokens.push('comments')
  if (shape.docs) tokens.push('docs')
  if (shape.newSourceFiles > 0) tokens.push('architecture', 'deepening')
  if (n === 1) tokens.push(...CLEANUP_TOKENS)
  return tokens
}

export const parseSelector = (input: string | undefined, shape: Shape, n: number): Selection => {
  const raw = input === undefined || input === '' ? 'full' : input
  if (Object.hasOwn(PRESETS, raw)) {
    const expanded = PRESETS[raw]
    return { input: raw, tokens: expanded === undefined ? [] : [expanded] }
  }
  const tokens = raw.split(',').map((token) => token.trim())
  const unknown = tokens.filter((token) => !SELECTOR_TOKENS.includes(token))
  if (unknown.length > 0) {
    throw new Error(`unknown selector token ${unknown.join(', ')}; expected full, quick or tokens of: ${SELECTOR_TOKENS.join(', ')}`)
  }
  const expanded = tokens.flatMap((token) => (token === 'auto' ? autoTokens(shape, n) : [token]))
  return { input: raw, tokens: [...new Set(expanded)] }
}

const selectedAngles = (tokens: readonly string[], settings: PlanInput['angles']): Set<Angle> => {
  if (tokens.length === 0) return new Set(ANGLES)
  const angles = new Set<Angle>()
  for (const token of tokens) {
    const fromToken = token === 'important' ? ANGLES.filter((angle) => ceilingOf(angle, settings) === 'Important') : (TOKEN_ANGLES[token] ?? [])
    fromToken.forEach((angle) => angles.add(angle))
  }
  return angles
}

const inapplicable = (angle: Angle, shape: Shape): string | undefined => {
  if (angle === 11 && !shape.docs) return 'no Markdown in the diff'
  if (angle === 15 && !shape.spec) return 'no spec found'
  if (angle === 16 && !shape.tests) return 'no tests in the diff'
  if (angle === 17 && !shape.comments) return 'no added comments'
  return undefined
}

const TIER_RANK: Readonly<Record<Tier, number>> = { fast: 0, standard: 1, deep: 2 }
const EFFORT_RANK: Readonly<Record<Effort, number>> = { low: 0, medium: 1, high: 2 }

const gradeOf = (angle: Angle, grades: Readonly<Record<string, Grade>>): Grade =>
  grades[ANGLE_TOKENS[angle]] ?? DEFAULT_GRADES[ANGLE_TOKENS[angle]] ?? { tier: 'standard', effort: 'high' }

const roleGrade = (key: string, grades: Readonly<Record<string, Grade>>): Grade =>
  grades[key] ?? { tier: 'deep', effort: 'medium' }

const strongest = (angles: readonly Angle[], grades: Readonly<Record<string, Grade>>): Grade =>
  angles.map((angle) => gradeOf(angle, grades)).reduce((best, grade) => ({
    tier: TIER_RANK[grade.tier] > TIER_RANK[best.tier] ? grade.tier : best.tier,
    effort: EFFORT_RANK[grade.effort] > EFFORT_RANK[best.effort] ? grade.effort : best.effort,
  }))

const splitByGrade = (name: string, kind: FinderKind, angles: readonly Angle[], grades: Readonly<Record<string, Grade>>): Finder[] => {
  const byGrade = new Map<string, { grade: Grade; angles: Angle[] }>()
  for (const angle of angles) {
    const grade = gradeOf(angle, grades)
    const key = `${grade.tier}-${grade.effort}`
    const entry = byGrade.get(key) ?? { grade, angles: [] }
    entry.angles.push(angle)
    byGrade.set(key, entry)
  }
  const entries = [...byGrade.entries()]
  return entries.map(([key, { grade, angles: own }]) => ({
    name: entries.length === 1 ? name : `${name}-${key}`,
    kind,
    angles: own,
    ...grade,
  }))
}

const layoutFinders = (n: number, angles: readonly Angle[], grades: Readonly<Record<string, Grade>>): Finder[] => {
  const has = (angle: Angle): boolean => angles.includes(angle)
  if (n === 1) {
    return angles.length === 0 ? [] : [{ name: 'single', kind: 'single', angles: [...angles], ...strongest(angles, grades) }]
  }
  const groups: { name: string; kind: FinderKind; angles: Angle[] }[] = []
  if (n >= 2) {
    const bugGroups = BUG_GROUPS[Math.min(n - 1, MAX_BUG_FINDERS)] ?? []
    bugGroups
      .map((group) => group.filter(has))
      .filter((group) => group.length > 0)
      .forEach((group, index) => groups.push({ name: `bugs-${index + 1}`, kind: 'bugs', angles: group }))
    groups.push({ name: 'cleanup', kind: 'cleanup', angles: CLEANUP.filter(has) })
    groups.push({ name: 'rules', kind: 'rules', angles: RULES.filter(has) })
  } else {
    groups.push({ name: 'rules', kind: 'rules', angles: ([11, 15] as const).filter(has) })
  }
  groups.push({ name: 'mechanical', kind: 'mechanical', angles: MECHANICAL.filter(has) })
  return groups.filter((group) => group.angles.length > 0).flatMap((group) => splitByGrade(group.name, group.kind, group.angles, grades))
}

export const planReview = (input: PlanInput): Plan => {
  const n = finderCount(input.lines)
  const grades = { ...DEFAULT_GRADES, ...input.grades }
  const selection = parseSelector(input.selector, input.shape, n)
  const wanted = selectedAngles(selection.tokens, input.angles)
  const skipped: Skipped[] = []
  const angles = ANGLES.filter((angle) => {
    if (!wanted.has(angle)) return false
    const reason = input.angles?.[angle]?.enabled === false ? 'disabled in the project config' : inapplicable(angle, input.shape)
    if (reason !== undefined) skipped.push({ angle, reason })
    return reason === undefined
  })
  const usedForCode = n === 0 ? angles.filter((angle) => angle === 11 || angle === 15 || angle === 16 || angle === 17) : angles
  ANGLES.filter((angle) => angles.includes(angle) && !usedForCode.includes(angle)).forEach((angle) =>
    skipped.push({ angle, reason: 'no counted code lines' }),
  )
  const wantsDeepening = selection.tokens.length === 0 ? input.shape.newSourceFiles > 0 : selection.tokens.includes('deepening')
  return {
    lines: input.lines,
    n,
    selection,
    outputTokens: selection.tokens.filter((token) => token !== 'deepening'),
    angles: usedForCode,
    skipped: skipped.sort((left, right) => left.angle - right.angle),
    finders: layoutFinders(n, usedForCode, grades),
    deepening: wantsDeepening && n > 0 ? roleGrade('deepening', grades) : undefined,
    verify: roleGrade('verify', grades),
    outcome: roleGrade('outcome', grades),
    composer: roleGrade('composer', grades),
  }
}

export interface JudgeModel {
  finderModel: string
  judgeModel: string
  same: boolean
}

export const judgeModels = (finderModels: readonly string[], verifyModels: readonly string[]): JudgeModel[] =>
  [...new Set(finderModels)].flatMap((finderModel) => {
    const other = verifyModels.find((model) => model !== finderModel)
    const first = verifyModels[0]
    if (other !== undefined) return [{ finderModel, judgeModel: other, same: false }]
    return first === undefined ? [] : [{ finderModel, judgeModel: first, same: true }]
  })

export const isTier = (value: string): value is Tier => (TIERS as readonly string[]).includes(value)
export const angleNumber = (key: string): Angle | undefined => {
  const value = Number(key)
  return Number.isInteger(value) && isAngle(value) ? value : undefined
}
