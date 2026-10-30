import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EnvironmentError } from './exec'

export const FINDING_STATUSES = ['open', 'fixed', 'skipped', 'unverified', 'no_change_needed', 'optional'] as const
export type FindingStatus = (typeof FINDING_STATUSES)[number]

export interface Finding {
  id: string
  status: FindingStatus
  severity: string | undefined
  category: string | undefined
  discussionId: string | undefined
  specQuote: string | undefined
}

export interface ReviewState {
  lastReviewedSha: string | undefined
  diffHash: string | undefined
  findings: Finding[]
}

/** The same key jig-review writes: the first 12 characters of `git hash-object` over `<remote>:<target>`. */
export const reviewStateKey = (remote: string, target: string): string => {
  const content = Buffer.from(`${remote}:${target}`, 'utf8')
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex').slice(0, 12)
}

/** Under the main checkout, so a review run in a linked worktree writes the same file the cycle reads. */
export const reviewStatePath = (mainRoot: string, remote: string, target: string): string =>
  join(mainRoot, '.jig', 'runs', 'review', `${reviewStateKey(remote, target)}.json`)

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const optionalText = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const isStatus = (value: unknown): value is FindingStatus =>
  typeof value === 'string' && (FINDING_STATUSES as readonly string[]).includes(value)

export const parseReviewState = (text: string, label: string): ReviewState => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new EnvironmentError(`${label}: not JSON`)
  }
  if (!isObject(raw) || !Array.isArray(raw['findings'])) throw new EnvironmentError(`${label}: no findings array`)
  const parsed = raw['findings'].map((entry: unknown, index): Finding | string => {
    if (!isObject(entry)) return `findings[${index}]: not an object`
    const status = entry['status']
    if (!isStatus(status)) return `findings[${index}] (${optionalText(entry['id']) ?? 'no id'}): status ${JSON.stringify(status ?? null)}`
    return {
      id: optionalText(entry['id']) ?? `#${index}`,
      status,
      severity: optionalText(entry['severity']),
      category: optionalText(entry['category']),
      discussionId: optionalText(entry['discussion_id']),
      specQuote: typeof entry['spec_quote'] === 'string' ? entry['spec_quote'] : undefined,
    }
  })
  const invalid = parsed.filter((item): item is string => typeof item === 'string')
  if (invalid.length > 0) {
    throw new EnvironmentError(
      `${label}: ${invalid.join(', ')} not one of ${FINDING_STATUSES.join('|')}; the state was edited outside jig: fix the status (a duplicate thread: jig review-cycle merge) or restore a .bak copy`,
    )
  }
  const findings = parsed.filter((item): item is Finding => typeof item !== 'string')
  return { lastReviewedSha: optionalText(raw['last_reviewed_sha']), diffHash: optionalText(raw['diff_hash']), findings }
}

/** undefined: no state file, the engine runs a first review. */
export const readReviewState = (path: string): ReviewState | undefined => {
  if (!existsSync(path)) return undefined
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new EnvironmentError(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseReviewState(text, path)
}

const CLOSED: ReadonlySet<FindingStatus> = new Set(['fixed', 'no_change_needed', 'optional'])

/** Findings whose thread is still unresolved: the engine's outcome check must give each one a status. */
export const standingFindings = (state: ReviewState): Finding[] => state.findings.filter((finding) => !CLOSED.has(finding.status))

const STANDING: ReadonlySet<FindingStatus> = new Set(['open', 'skipped'])

/** Posted Important findings the last outcome check left standing; `unverified` is not among them: the check could not tell. */
export const blockingFindings = (state: ReviewState): Finding[] =>
  state.findings.filter((finding) => finding.severity === 'Important' && STANDING.has(finding.status) && finding.discussionId !== undefined)

export interface Tally {
  degraded: string | undefined
  prior: number
}

const PRIOR_KEYS = ['prior_fixed', 'prior_skipped', 'prior_unverified', 'prior_no_change_needed'] as const

export const parseTally = (text: string): Tally => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new EnvironmentError('tally: not JSON')
  }
  if (!isObject(raw)) throw new EnvironmentError('tally: expected an object')
  let prior = 0
  for (const key of PRIOR_KEYS) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new EnvironmentError(`tally: ${key} is not a count`)
    prior += value
  }
  const degraded = raw['degraded']
  return { degraded: typeof degraded === 'string' && degraded.trim() !== '' ? degraded : undefined, prior }
}

export type Reconciled =
  | { kind: 'ok'; standing: number; accounted: number }
  | { kind: 'blocked'; reason: string; firstRun: boolean }

/**
 * `before` is the state as it was before the review ran (undefined: no state file then, a first run).
 * Degraded first; then the tally must account for every standing finding. More is fine: the engine
 * adopts hand-written threads into its state.
 */
export const reconcile = (before: ReviewState | undefined, tally: Tally): Reconciled => {
  if (tally.degraded !== undefined) return { kind: 'blocked', reason: `degraded: ${tally.degraded}`, firstRun: before === undefined }
  const standing = before === undefined ? 0 : standingFindings(before).length
  if (tally.prior < standing) {
    return { kind: 'blocked', reason: `tally accounts for ${tally.prior} of ${standing} standing findings`, firstRun: before === undefined }
  }
  return { kind: 'ok', standing, accounted: tally.prior }
}

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Unposted open spec findings whose `spec_quote` does not occur verbatim (whitespace-normalised) in the spec. */
export const specHold = (state: ReviewState, spec: string): string[] => {
  const specText = flat(spec)
  const isQuoted = (finding: Finding): boolean =>
    finding.specQuote !== undefined && flat(finding.specQuote) !== '' && specText.includes(flat(finding.specQuote))
  return state.findings
    .filter((finding) => finding.category === 'spec' && finding.status === 'open' && finding.discussionId === undefined && !isQuoted(finding))
    .map((finding) => finding.id)
}

const updateFindings = (path: string, ids: readonly string[], backup: string, change: (finding: Json) => void, now: Date): number => {
  if (ids.length === 0 || !existsSync(path)) return 0
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isObject(raw) || !Array.isArray(raw['findings'])) throw new EnvironmentError(`${path}: no findings array`)
  const hits = raw['findings'].filter(
    (finding): finding is Json => isObject(finding) && typeof finding['discussion_id'] === 'string' && ids.includes(finding['discussion_id']),
  )
  if (hits.length === 0) return 0
  copyFileSync(path, `${path}.bak-${backup}-${now.toISOString().replace(/[:.]/g, '-')}`)
  hits.forEach(change)
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`)
  return hits.length
}

/** Findings of merged duplicate threads close as `no_change_needed` and keep their resolved thread, so no run adopts or reposts it. */
export const mergeInState = (path: string, merged: readonly string[], now: Date = new Date()): number =>
  updateFindings(path, merged, 'merge', (finding) => {
    finding['status'] = 'no_change_needed'
  }, now)

/**
 * Withdrawn threads leave the state: their findings become `no_change_needed` without a thread, so
 * the next run neither reposts nor rechecks them. A copy of the file is kept first.
 */
export const withdrawFromState = (path: string, gone: readonly string[], now: Date = new Date()): number =>
  updateFindings(path, gone, 'withdraw', (finding) => {
    finding['status'] = 'no_change_needed'
    finding['discussion_id'] = null
  }, now)
