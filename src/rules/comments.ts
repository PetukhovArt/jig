import { basename } from 'node:path'
import { lexComments } from '../catalog/languages'
import type { Edit } from './rule'

export interface AddedComment {
  text: string
  key: string
  line: number
  lineIn: 'file' | 'new-text'
}

type FoundComment = Omit<AddedComment, 'lineIn'>

const CONFIG_FILE = [/^\./, /\.(?:config|conf)\./]

const lf = (text: string): string => text.replace(/\r\n/g, '\n')

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

export const isConfigFile = (file: string): boolean => CONFIG_FILE.some((pattern) => pattern.test(basename(file)))

const commentsIn = (file: string, text: string): FoundComment[] =>
  (lexComments(file, text) ?? []).map((comment) => ({ text: comment.text, key: normalize(comment.text), line: comment.line }))

const isSubsequence = (short: string, long: string): boolean => {
  const wanted = [...short]
  let found = 0
  for (const char of long) {
    if (char === wanted[found]) found++
  }
  return found === wanted.length
}

const unmatched = (file: string, before: readonly string[], after: readonly string[]): FoundComment[] => {
  const left = new Map<string, number>()
  for (const text of before) {
    for (const { key } of commentsIn(file, text)) left.set(key, (left.get(key) ?? 0) + 1)
  }
  const fresh = after.flatMap((text) => commentsIn(file, text)).filter(({ key }) => {
    const count = left.get(key) ?? 0
    if (count > 0) left.set(key, count - 1)
    return count === 0
  })
  const shortenable = [...left].flatMap(([key, count]) => Array.from({ length: count }, () => key))
  return fresh.filter(({ key }) => {
    const source = shortenable.findIndex((old) => isSubsequence(key, old))
    if (source !== -1) shortenable.splice(source, 1)
    return source === -1
  })
}

const applyEdits = (current: string, edits: readonly Edit[]): string | undefined => {
  let text = current
  for (const edit of edits) {
    const before = lf(edit.before)
    const after = lf(edit.after)
    if (before === '' && text === '') {
      text = after
      continue
    }
    const at = before === '' ? -1 : text.indexOf(before)
    if (at === -1) return undefined
    text = text.slice(0, at) + after + text.slice(at + before.length)
  }
  return text
}

export const addedComments = (file: string, edits: readonly Edit[], current?: string): AddedComment[] | undefined => {
  if (lexComments(file, '') === undefined) return undefined
  const original = lf(current ?? '')
  const result = applyEdits(original, edits)
  if (result !== undefined) return unmatched(file, [original], [result]).map((comment) => ({ ...comment, lineIn: 'file' }))
  const befores = edits.map((edit) => lf(edit.before))
  const afters = edits.map((edit) => lf(edit.after))
  return unmatched(file, befores, afters).map((comment) => ({ ...comment, lineIn: 'new-text' }))
}
