import { lexComments, type Comment } from './lexer'
import { fileLine, type Edit } from './rule'

export interface AddedComment {
  text: string
  key: string
  line: number
}

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

const countExisting = (file: string, edits: readonly Edit[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const edit of edits) {
    for (const comment of lexComments(file, edit.before) ?? []) {
      const key = normalize(comment.text)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

const commentsOf = (file: string, edit: Edit): { comment: Comment; line: number }[] => {
  if (edit.prefix === undefined) {
    return (lexComments(file, edit.after) ?? []).map((comment) => ({ comment, line: fileLine(edit, comment.line) }))
  }
  const { prefix } = edit
  return (lexComments(file, prefix + edit.after) ?? [])
    .filter((comment) => comment.start >= prefix.length)
    .map((comment) => ({ comment, line: comment.line }))
}

export const addedComments = (file: string, edits: readonly Edit[]): AddedComment[] | undefined => {
  if (lexComments(file, '') === undefined) return undefined
  const existing = countExisting(file, edits)
  const added: AddedComment[] = []
  for (const edit of edits) {
    for (const { comment, line } of commentsOf(file, edit)) {
      const key = normalize(comment.text)
      const remaining = existing.get(key) ?? 0
      if (remaining > 0) {
        existing.set(key, remaining - 1)
        continue
      }
      added.push({ text: comment.text, key, line })
    }
  }
  return added
}
