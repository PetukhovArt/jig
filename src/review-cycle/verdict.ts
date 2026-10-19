import type { ProcessAdapter, Transition } from './adapter'
import { BlockedRefError, EnvironmentError } from './exec'

/**
 * One merge request's outcome in this cycle. `held` covers everything that must not move the ref:
 * skipped (draft, stale, unchanged, busy), blocked, or reviewed with threads still open and nothing new posted.
 */
export const OUTCOMES = ['returned', 'ready', 'approved', 'held'] as const
export type Outcome = (typeof OUTCOMES)[number]

export interface MrOutcome {
  refs: string
  outcome: Outcome
}

export const splitRefs = (refs: string): string[] =>
  refs
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref !== '')

/**
 * A ref folds over all of its merge requests: any returned → returned; all ready or approved with
 * at least one ready → ready; all approved → none (clear the cycle's marker); anything else → no transition.
 */
export const foldVerdicts = (outcomes: readonly MrOutcome[]): Map<string, Transition | undefined> => {
  const byRef = new Map<string, Outcome[]>()
  for (const { refs, outcome } of outcomes) {
    for (const ref of splitRefs(refs)) {
      byRef.set(ref, [...(byRef.get(ref) ?? []), outcome])
    }
  }
  const verdicts = new Map<string, Transition | undefined>()
  for (const [ref, list] of byRef) {
    if (list.includes('returned')) verdicts.set(ref, 'returned')
    else if (list.every((outcome) => outcome === 'approved')) verdicts.set(ref, 'none')
    else if (list.every((outcome) => outcome === 'ready' || outcome === 'approved')) verdicts.set(ref, 'ready')
    else verdicts.set(ref, undefined)
  }
  return verdicts
}

export interface VerdictLine {
  ref: string
  text: string
  failed: boolean
}

/** Calls the adapter's `transition` once per ref with a verdict, after every merge request of the cycle has run. */
export const applyVerdicts = (adapter: ProcessAdapter, verdicts: ReadonlyMap<string, Transition | undefined>, dryRun: boolean): VerdictLine[] => {
  const lines: VerdictLine[] = []
  for (const [ref, target] of verdicts) {
    if (target === undefined) {
      lines.push({ ref, text: `${ref}: no transition (an MR of it was skipped, blocked or still open)`, failed: false })
      continue
    }
    if (dryRun) {
      lines.push({ ref, text: `${ref} → ${target} (dry run)`, failed: false })
      continue
    }
    try {
      const output = adapter.transition(ref, target)
      lines.push(...(output.length > 0 ? output : [`${ref} → ${target}`]).map((text) => ({ ref, text, failed: false })))
    } catch (error) {
      if (error instanceof BlockedRefError) lines.push({ ref, text: `${ref}: ${error.message}`, failed: false })
      else if (error instanceof EnvironmentError) lines.push({ ref, text: `${ref}: status not recorded, ${error.message}`, failed: true })
      else throw error
    }
  }
  return lines
}
