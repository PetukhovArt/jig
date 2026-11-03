import { TIERS, type Tier } from '../tiers/tiers'
import { partitionFiles, type Edge, type Partition, type PartitionFile } from './partition'

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
  8: 'efficiency',
  12: 'bugs',
  14: 'security',
  15: 'spec',
} as const satisfies Record<number, string>

export type Angle = keyof typeof ANGLE_TOKENS
const isAngle = (value: number): value is Angle => Object.hasOwn(ANGLE_TOKENS, value)
export const ANGLES: readonly Angle[] = Object.keys(ANGLE_TOKENS).map(Number).filter(isAngle)

export const REMOVED_ANGLES: readonly number[] = [6, 7, 9, 10, 11, 13, 16, 17]

const IMPORTANT_ANGLES: readonly Angle[] = [1, 2, 3, 4, 5, 8, 12, 14, 15]

const TOKEN_ANGLES: Readonly<Record<string, readonly Angle[]>> = {
  bugs: [1, 2, 3, 4, 5, 12],
  security: [14],
  efficiency: [8],
  spec: [15],
}
const SPECIAL_TOKENS = ['important', 'deepening'] as const
export const SELECTOR_TOKENS = [...SPECIAL_TOKENS, ...Object.keys(TOKEN_ANGLES), 'auto']
const PRESETS: Readonly<Record<string, string | undefined>> = { full: undefined, quick: 'important' }

export const DEFAULT_GRADES: Readonly<Record<string, Grade>> = {
  behavior: { tier: 'deep', effort: 'high' },
  conventions: { tier: 'standard', effort: 'high' },
  verify: { tier: 'deep', effort: 'medium' },
  outcome: { tier: 'deep', effort: 'medium' },
  composer: { tier: 'standard', effort: 'medium' },
  deepening: { tier: 'deep', effort: 'high' },
  flow: { tier: 'deep', effort: 'high' },
}
export const GRADE_KEYS = Object.keys(DEFAULT_GRADES)

export interface Shape {
  newSourceFiles: number
  spec: boolean
}

export interface AngleSettings {
  enabled?: boolean
  severityCeiling?: Ceiling
}

export const LAYOUTS = ['auto', 'lean', 'solo'] as const
export type Layout = (typeof LAYOUTS)[number]
export type ConcreteLayout = Exclude<Layout, 'auto'>
export const isLayout = (value: string): value is Layout => (LAYOUTS as readonly string[]).includes(value)

export const resolveAuto = (layout: Layout): ConcreteLayout => (layout === 'auto' ? 'lean' : layout)

export type Judging = 'important' | 'self'

export interface ProjectAngle extends AngleSettings {
  name: string
  file: string
  kind: FinderKind
}

export const PROJECT_ANGLE_NAME = /^[a-z][a-z0-9-]*$/

export interface PlanInput {
  lines: number
  shape: Shape
  layout?: Layout | undefined
  selector?: string | undefined
  angles?: Readonly<Partial<Record<Angle, AngleSettings>>>
  projectAngles?: readonly ProjectAngle[]
  grades?: Readonly<Record<string, Grade>>
  rereview?: boolean
  files?: readonly PartitionFile[]
  edges?: readonly Edge[]
}

export const FINDER_KINDS = ['behavior', 'conventions'] as const
export type FinderKind = (typeof FINDER_KINDS)[number]

export const KIND_ANGLES: Readonly<Record<FinderKind, readonly Angle[]>> = {
  behavior: [1, 2, 3, 4, 5, 8, 12, 14, 15],
  conventions: [],
}

export const REREVIEW_FULL_LAYOUT_LINES = 600

export const isLightRereview = (rereview: boolean | undefined, lines: number): boolean => rereview === true && lines < REREVIEW_FULL_LAYOUT_LINES

export interface Finder extends Grade {
  name: string
  kind: FinderKind
  angles: Angle[]
  projectAngles: string[]
  partition: string
}

export interface Skipped {
  angle: Angle | string
  reason: string
}

export type SelectorSource = 'argument' | 'default'

export interface Selection {
  input: string
  tokens: string[]
  source: SelectorSource
}

export type ReviewPath = 'subagents' | 'none'

export interface Plan {
  lines: number
  n: number
  layout: ConcreteLayout
  path: ReviewPath
  judging: Judging
  selection: Selection
  outputTokens: string[]
  angles: Angle[]
  projectAngles: ProjectAngle[]
  skipped: Skipped[]
  partitions: Partition[]
  flow: Grade | undefined
  finders: Finder[]
  deepening: Grade | undefined
  verify: Grade
  outcome: Grade
  composer: Grade
}

export const finderCount = (lines: number): number => Math.min(MAX_FINDERS, Math.ceil(Math.max(0, lines) / LINES_PER_FINDER))

const ceilingOf = (angle: Angle, settings: PlanInput['angles']): Ceiling =>
  settings?.[angle]?.severityCeiling ?? (IMPORTANT_ANGLES.includes(angle) ? 'Important' : 'Nit')

export const autoTokens = (shape: Shape): string[] => (shape.newSourceFiles > 0 ? ['important', 'deepening'] : ['important'])

export const parseSelector = (input: string | undefined, shape: Shape): Selection => {
  const given = input !== undefined && input !== ''
  const source: SelectorSource = given ? 'argument' : 'default'
  const raw = given ? input : 'full'
  if (Object.hasOwn(PRESETS, raw)) {
    const expanded = PRESETS[raw]
    return { input: raw, tokens: expanded === undefined ? [] : [expanded], source }
  }
  const tokens = raw.split(',').map((token) => token.trim())
  const unknown = tokens.filter((token) => !SELECTOR_TOKENS.includes(token))
  if (unknown.length > 0) {
    throw new Error(`unknown selector token ${unknown.join(', ')}; expected full, quick or tokens of: ${SELECTOR_TOKENS.join(', ')}`)
  }
  const expanded = tokens.flatMap((token) => (token === 'auto' ? autoTokens(shape) : [token]))
  return { input: raw, tokens: [...new Set(expanded)], source }
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

const inapplicable = (angle: Angle, shape: Shape): string | undefined => (angle === 15 && !shape.spec ? 'no spec found' : undefined)

const roleGrade = (key: string, grades: Readonly<Record<string, Grade>>): Grade =>
  grades[key] ?? { tier: 'deep', effort: 'medium' }

const partitionFinders = (
  partitions: readonly Partition[],
  angles: readonly Angle[],
  projectAngles: readonly ProjectAngle[],
  grades: Readonly<Record<string, Grade>>,
): Finder[] =>
  partitions.flatMap((partition) =>
    FINDER_KINDS.map((kind) => ({
      name: `${partition.name}-${kind}`,
      kind,
      angles: angles.filter((angle) => KIND_ANGLES[kind].includes(angle)),
      projectAngles: projectAngles.filter((angle) => angle.kind === kind).map((angle) => angle.name),
      partition: partition.name,
      ...roleGrade(kind, grades),
    })).filter((finder) => finder.angles.length + finder.projectAngles.length > 0),
  )

const projectAngleWanted = (angle: ProjectAngle, tokens: readonly string[]): boolean =>
  tokens.length === 0 || (tokens.includes('important') && (angle.severityCeiling ?? 'Important') === 'Important')

const skipOrder = (skip: Skipped): [number, string] => (typeof skip.angle === 'number' ? [skip.angle, ''] : [Number.MAX_SAFE_INTEGER, skip.angle])

const bySkipOrder = (left: Skipped, right: Skipped): number => {
  const [leftNumber, leftName] = skipOrder(left)
  const [rightNumber, rightName] = skipOrder(right)
  return leftNumber - rightNumber || leftName.localeCompare(rightName)
}

const namedPartitions = (count: number): Partition[] =>
  Array.from({ length: count }, (_, index) => ({ name: `p${index + 1}`, files: [], lines: 0, dirs: [] }))

const partitionsOf = (input: PlanInput, count: number): Partition[] =>
  input.files === undefined ? namedPartitions(count) : partitionFiles(input.files, input.edges ?? [], count)

export const planReview = (input: PlanInput): Plan => {
  const n = finderCount(input.lines)
  const layout = resolveAuto(input.layout ?? 'auto')
  const grades = { ...DEFAULT_GRADES, ...input.grades }
  const selection = parseSelector(input.selector, input.shape)
  const wanted = selectedAngles(selection.tokens, input.angles)
  const skipped: Skipped[] = []
  const angles = ANGLES.filter((angle) => {
    if (!wanted.has(angle)) return false
    const reason = input.angles?.[angle]?.enabled === false ? 'disabled in the project config' : inapplicable(angle, input.shape)
    if (reason !== undefined) skipped.push({ angle, reason })
    return reason === undefined
  })
  const usedForCode = n === 0 ? angles.filter((angle) => angle === 15) : angles
  ANGLES.filter((angle) => angles.includes(angle) && !usedForCode.includes(angle)).forEach((angle) =>
    skipped.push({ angle, reason: 'no counted code lines' }),
  )
  const projectAngles = (input.projectAngles ?? []).filter((angle) => {
    if (!projectAngleWanted(angle, selection.tokens)) return false
    const reason = angle.enabled === false ? 'disabled in the project config' : n === 0 ? 'no counted code lines' : undefined
    if (reason !== undefined) skipped.push({ angle: angle.name, reason })
    return reason === undefined
  })
  const light = isLightRereview(input.rereview, input.lines)
  const wantsDeepening = !light && (selection.tokens.length === 0 ? input.shape.newSourceFiles > 0 : selection.tokens.includes('deepening'))
  const path: ReviewPath = usedForCode.length + projectAngles.length === 0 ? 'none' : 'subagents'
  const partitions = path === 'none' ? [] : partitionsOf(input, light ? 1 : Math.max(1, n))
  return {
    lines: input.lines,
    n,
    layout,
    path,
    judging: layout === 'solo' ? 'self' : 'important',
    selection,
    outputTokens: selection.tokens.filter((token) => token !== 'deepening'),
    angles: usedForCode,
    projectAngles,
    skipped: skipped.sort(bySkipOrder),
    partitions,
    flow: path === 'none' ? undefined : roleGrade('flow', grades),
    finders: partitionFinders(partitions, usedForCode, projectAngles, grades),
    deepening: wantsDeepening && n > 0 ? roleGrade('deepening', grades) : undefined,
    verify: roleGrade('verify', grades),
    outcome: roleGrade('outcome', grades),
    composer: roleGrade('composer', grades),
  }
}

export const MODES = ['review', 'pre-mr'] as const
export type Mode = (typeof MODES)[number]

const BUG_ANGLES: readonly Angle[] = [1, 2, 3, 4, 5, 12, 14]

/** A file under the skill directory the main session reads for this run, with the part of it that applies. */
export interface StepRef {
  file: string
  when?: string
}

export const gateFiles = (angles: readonly Angle[], projectAngles: readonly ProjectAngle[] = []): string[] => [
  ...(angles.some((angle) => BUG_ANGLES.includes(angle)) || projectAngles.some((angle) => angle.kind === 'behavior') ? ['gates/bugs.md'] : []),
  ...(angles.some((angle) => !BUG_ANGLES.includes(angle)) || projectAngles.some((angle) => angle.kind === 'conventions') ? ['gates/shape.md'] : []),
  'gates/severity.md',
]

/** The steps after prepare that apply to this run, in order; `state` is mode `review` with a known merge request and state on. */
export const stepsFor = (plan: Plan, mode: Mode, state: boolean): StepRef[] => {
  const output: StepRef = { file: 'steps/08-output.md', when: mode === 'pre-mr' ? 'section "Pre-mr verdict"' : state ? 'sections "Write state" and "Output"' : 'section "Output"' }
  if (plan.path === 'none') return [output]
  const steps: StepRef[] = [{ file: 'steps/02-rules.md' }]
  if (state) {
    steps.push(
      { file: 'steps/03-state.md' },
      { file: 'references/state-schema.md' },
      { file: 'steps/09-rereview.md', when: 'only when the state file exists: replaces the next steps up to rank for its scope' },
    )
  }
  steps.push({ file: 'steps/04-flow-model.md' })
  if (plan.judging === 'important') {
    steps.push({ file: 'steps/04-finders.md', when: 'without section "Layout solo"' }, { file: 'steps/05-verify.md', when: 'without section "Layout solo"' }, ...gateFiles(plan.angles, plan.projectAngles).map((file) => ({ file })))
  } else steps.push({ file: 'steps/04-finders.md' }, { file: 'steps/05-verify.md', when: 'without section "Layout lean"' })
  steps.push({ file: 'steps/06-rank.md' })
  if (state) steps.push({ file: 'steps/07-comments.md' })
  steps.push(output)
  if (state) steps.push({ file: 'references/posting.md', when: 'only with --post or an explicit request' })
  return steps
}

export interface JudgeModel {
  finderModel: string
  judgeModel: string
  same: boolean
}

export const judgeModels = (finderModels: readonly string[], verifyModels: readonly string[]): JudgeModel[] =>
  [...new Set(finderModels)].flatMap((finderModel): JudgeModel[] => {
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
