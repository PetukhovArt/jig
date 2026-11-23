import { resolveBase } from '../review/review-plan'

export interface UiBase {
  label: string
  mergeBase: string
  tracked: string[]
}

export const resolveUiBase = (root: string, given: string | undefined, command: string): UiBase => {
  try {
    const base = resolveBase(root, given, command)
    return { label: `${base.ref} (merge base ${base.mergeBase.slice(0, 8)})`, mergeBase: base.mergeBase, tracked: base.stats.map((stat) => stat.path) }
  } catch (error) {
    if (given !== undefined) throw error
    return { label: 'HEAD (no upstream: uncommitted and untracked files only)', mergeBase: 'HEAD', tracked: [] }
  }
}
