import { createHash } from 'node:crypto'
import type { SessionState } from '../core/state'
import type { Outcome, TodoItem } from '../hook/types'
import type { JournalNote } from '../tools/tool'

export const TODO_RULE = 'jig/todos'
export const TODO_LIST_LIMIT = 5
export const TODO_TEXT_LIMIT = 120
export const MAX_TODO_BLOCKS_PER_TURN = 3

const CLOSED_PREFIX = /^\s*(?:skip|n\/a)\s*:/i

export interface TodoVerdict {
  outcome: Outcome
  notes: JournalNote[]
}

const PASS: TodoVerdict = { outcome: { type: 'none' }, notes: [] }

export const openTodos = (todos: readonly TodoItem[]): TodoItem[] =>
  todos.filter((todo) => todo.status !== 'completed' && !CLOSED_PREFIX.test(todo.text))

const fingerprintOf = (open: readonly TodoItem[]): string =>
  createHash('sha1')
    .update(open.map((todo) => todo.text.trim()).sort().join('\n'))
    .digest('hex')

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= TODO_TEXT_LIMIT ? line : `${line.slice(0, TODO_TEXT_LIMIT - 1)}…`
}

export const todoReason = (open: readonly TodoItem[]): string => {
  const shown = open.slice(0, TODO_LIST_LIMIT).map((todo) => `- [${todo.status}] ${clip(todo.text)}`)
  const hidden = open.length - shown.length
  return [
    `${TODO_RULE}: ${open.length} todo item(s) still open:`,
    ...shown,
    ...(hidden > 0 ? [`- … and ${hidden} more`] : []),
    'Finish each, or rewrite its text as `skip: <reason>` and mark it completed, then stop.',
  ].join('\n')
}

const passNote = (kind: 'gate-unresolved' | 'gate-giveup', open: readonly TodoItem[]): TodoVerdict => ({
  outcome: { type: 'none' },
  notes: [{ kind, tool: 'jig', rule: TODO_RULE, message: `${open.length} todo item(s) left open: ${open.map((todo) => clip(todo.text)).join('; ')}` }],
})

export const todoGate = (todos: readonly TodoItem[] | undefined, state: SessionState, isOn: () => boolean): TodoVerdict => {
  if (todos === undefined) return PASS
  const open = openTodos(todos)
  if (open.length === 0 || !isOn()) return PASS
  const fingerprint = fingerprintOf(open)
  const prior = state.todos
  if (prior?.accepted === fingerprint) return PASS
  const isSameTurn = prior !== undefined && prior.turn === state.turn
  if (isSameTurn && prior.fingerprint === fingerprint) {
    state.todos = { ...prior, accepted: fingerprint }
    return passNote('gate-unresolved', open)
  }
  const blocks = isSameTurn ? prior.blocks + 1 : 1
  if (blocks > MAX_TODO_BLOCKS_PER_TURN) {
    state.todos = { turn: state.turn, fingerprint, blocks, accepted: fingerprint }
    return passNote('gate-giveup', open)
  }
  state.todos = { turn: state.turn, fingerprint, blocks, ...(prior?.accepted === undefined ? {} : { accepted: prior.accepted }) }
  return {
    outcome: { type: 'block', reason: todoReason(open) },
    notes: [{ kind: 'gate-block', tool: 'jig', rule: TODO_RULE, message: `${open.length} open todo item(s)` }],
  }
}
