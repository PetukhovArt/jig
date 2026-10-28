import type { Discussion, Note } from './forge'
import type { Finding } from './state'
import type { Outcome } from './verdict'

/**
 * A thread is optional when its opening note starts with the Nit or Pre-existing chip. The two
 * header forms are the optional-items note as an older engine posted it, before it carried the chip.
 */
export const OPTIONAL_OPENING = /^\*\*(\[[^\]]*(Nit|Pre-existing)|(Улучшения|Упрощения) — по желанию)/

export const isOptionalNote = (note: Note): boolean => OPTIONAL_OPENING.test(note.body.trim())

const FYI_MARKER = '<!-- review-fyi -->'

const isFyiNote = (note: Note): boolean => note.body.includes(FYI_MARKER)

const humanNotes = (discussion: Discussion): Note[] => discussion.notes.filter((note) => !note.system)

const isOpen = (discussion: Discussion): boolean => discussion.notes.some((note) => note.resolvable && !note.resolved)

const time = (iso: string): number => {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? 0 : parsed
}

const latest = (stamps: readonly string[]): string | undefined =>
  stamps.reduce<string | undefined>((best, stamp) => (best === undefined || time(stamp) > time(best) ? stamp : best), undefined)

/** Unresolved threads on the merge request, by anyone, without the optional ones. */
export const countUnresolved = (discussions: readonly Discussion[]): number =>
  discussions.filter((discussion) => {
    const [opening] = humanNotes(discussion)
    return opening !== undefined && !isOptionalNote(opening) && isOpen(discussion)
  }).length

export interface ThreadFacts {
  /** My latest note anywhere on the merge request. */
  myLastNote: string | undefined
  /** My open threads that are not optional: they wait on the developer. */
  myUnresolved: number
  /** My open threads, and my FYI note, where someone else wrote after my last note: they wait on an answer from the review. */
  unanswered: number
}

export const threadFacts = (discussions: readonly Discussion[], me: string): ThreadFacts => {
  const isMine = (note: Note): boolean => note.author === me && !note.system
  let myLastNote: string | undefined
  let myUnresolved = 0
  let unanswered = 0
  for (const discussion of discussions) {
    const mine = discussion.notes.filter(isMine)
    const [myFirst] = mine
    if (myFirst === undefined) continue
    const open = isOpen(discussion)
    if (open && !isOptionalNote(myFirst)) myUnresolved++
    const myLastHere = latest(mine.map((note) => note.createdAt)) ?? ''
    myLastNote = latest(myLastNote === undefined ? [myLastHere] : [myLastNote, myLastHere])
    const [opening] = discussion.notes
    const ownsThread = opening !== undefined && isMine(opening)
    const answeredAfter = discussion.notes.some((note) => !note.system && !isMine(note) && time(note.createdAt) > time(myLastHere))
    const awaitsAnswer = open || (opening !== undefined && isFyiNote(opening))
    if (awaitsAnswer && ownsThread && answeredAfter) unanswered++
  }
  return { myLastNote, myUnresolved, unanswered }
}

export const standingBlocking = (findings: readonly Finding[], discussions: readonly Discussion[]): number => {
  const open = new Set(discussions.filter(isOpen).map((discussion) => discussion.id))
  return findings.filter((finding) => finding.discussionId !== undefined && open.has(finding.discussionId)).length
}

export const lastCommit = (commitDates: readonly string[]): string | undefined => latest(commitDates)

export const SKIP_REASONS = ['approved', 'draft', 'busy', 'unchanged', 'stale'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export type Decision = { kind: 'actionable' } | { kind: 'skip'; reason: SkipReason }

/**
 * Unchanged and stale both mean the developer has not answered my threads: a standing blocking finding
 * returns the merge request, or a ref moved back to review by hand waits on nobody.
 */
export const skipOutcome = (reason: SkipReason, blocking: number): Outcome => {
  if (reason === 'approved') return 'approved'
  if ((reason === 'unchanged' || reason === 'stale') && blocking > 0) return 'returned'
  return 'held'
}

export interface RowFacts {
  approved: boolean
  draft: boolean
  /** The review worktree of this merge request is live: the previous cycle still reviews it. */
  busy: boolean
}

export interface ReviewFacts {
  staleRule: boolean
  threads: ThreadFacts
  lastCommit: string | undefined
  /** `last_reviewed_sha` of the review state; undefined without a state file. */
  reviewedSha: string | undefined
  headSha: string | undefined
  /** The head's diff against its target hashes to the state's `diff_hash`: a rebase or a merged target moved no patch. */
  reviewedDiff: boolean
}

/** Rules 1, 2 and the busy worktree: decided off the queue row, before any per-merge-request call. */
export const preDecision = (row: RowFacts): Decision | undefined => {
  if (row.approved) return { kind: 'skip', reason: 'approved' }
  if (row.draft) return { kind: 'skip', reason: 'draft' }
  if (row.busy) return { kind: 'skip', reason: 'busy' }
  return undefined
}

/** The head sha is needed only for rule 4: a state file exists and no developer reply waits on an answer. */
export const needsHeadSha = (threads: ThreadFacts, reviewedSha: string | undefined): boolean =>
  reviewedSha !== undefined && threads.unanswered === 0

/**
 * Rule 4 (unchanged: the reviewed head, or a new head with the reviewed diff) wins over rule 3 (stale). Stale: I hold an unresolved thread, no commit landed
 * after my last note and nobody answered me since; it skips only under the adapter's `stale=on`.
 */
export const reviewDecision = (facts: ReviewFacts): Decision => {
  const { threads } = facts
  const isUnchanged =
    threads.unanswered === 0 && facts.reviewedSha !== undefined && facts.headSha !== undefined && (facts.reviewedSha === facts.headSha || facts.reviewedDiff)
  if (isUnchanged) return { kind: 'skip', reason: 'unchanged' }
  const isStale =
    threads.myUnresolved > 0 &&
    threads.unanswered === 0 &&
    threads.myLastNote !== undefined &&
    facts.lastCommit !== undefined &&
    time(facts.lastCommit) <= time(threads.myLastNote)
  if (isStale && facts.staleRule) return { kind: 'skip', reason: 'stale' }
  return { kind: 'actionable' }
}
