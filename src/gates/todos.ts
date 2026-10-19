import { createHash } from 'node:crypto'
import type { SessionState } from '../core/state'
import type { Outcome, TodoItem } from '../hook/types'
import type { JournalNote } from '../tools/tool'

export const TODO_RULE = 'jig/todos'
export const TODO_LIST_LIMIT = 5
export const TODO_TEXT_LIMIT = 120
export const MAX_TODO_BLOCKS_PER_TURN = 3

const CLOSED_PREFIX = /^\s*(?:skip|n\/a)\s*:/i
const NO_LIST = 'no todo list'
const CLOSE_HINT = 'Finish each, or rewrite its text as `skip: <reason>` and mark it completed, then stop.'
const NO_LIST_REASON = [
  `${TODO_RULE}: this /jig task has no todo list.`,
  'Put each numbered step of the flow into your todo tool as its own item. Do each step, or rewrite its text as `skip: <reason>` and mark it completed, then stop.',
].join('\n')

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
    CLOSE_HINT,
  ].join('\n')
}

interface Gap {
  fingerprint: string
  reason: string
  summary: string
}

const gapOf = (todos: readonly TodoItem[], isFlowTurn: boolean): Gap | undefined => {
  if (todos.length === 0) return isFlowTurn ? { fingerprint: NO_LIST, reason: NO_LIST_REASON, summary: NO_LIST } : undefined
  const open = openTodos(todos)
  if (open.length === 0) return undefined
  return {
    fingerprint: fingerprintOf(open),
    reason: todoReason(open),
    summary: `${open.length} todo item(s) left open: ${open.map((todo) => clip(todo.text)).join('; ')}`,
  }
}

const passNote = (kind: 'gate-unresolved' | 'gate-giveup', gap: Gap): TodoVerdict => ({
  outcome: { type: 'none' },
  notes: [{ kind, tool: 'jig', rule: TODO_RULE, message: gap.summary }],
})

export const todoGate = (todos: readonly TodoItem[] | undefined, state: SessionState, isOn: () => boolean): TodoVerdict => {
  if (todos === undefined) return PASS
  const gap = gapOf(todos, state.flowTurn === state.turn)
  if (gap === undefined || !isOn()) return PASS
  const { fingerprint } = gap
  const prior = state.todos
  if (prior?.accepted === fingerprint && fingerprint !== NO_LIST) return PASS
  const isSameTurn = prior !== undefined && prior.turn === state.turn
  if (isSameTurn && prior.fingerprint === fingerprint) {
    state.todos = { ...prior, accepted: fingerprint }
    return passNote('gate-unresolved', gap)
  }
  const blocks = isSameTurn ? prior.blocks + 1 : 1
  if (blocks > MAX_TODO_BLOCKS_PER_TURN) {
    state.todos = { turn: state.turn, fingerprint, blocks, accepted: fingerprint }
    return passNote('gate-giveup', gap)
  }
  state.todos = { turn: state.turn, fingerprint, blocks, ...(prior?.accepted === undefined ? {} : { accepted: prior.accepted }) }
  return {
    outcome: { type: 'block', reason: gap.reason },
    notes: [{ kind: 'gate-block', tool: 'jig', rule: TODO_RULE, message: gap.summary }],
  }
}
