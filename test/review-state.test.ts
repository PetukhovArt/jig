import { describe, expect, it } from 'vitest'
import { summarizeState } from '../src/review/state-summary'

describe('review state summary', () => {
  it('counts the postable set from the state, whatever a brief lists', () => {
    const summary = summarizeState({
      findings: [
        { id: 'a', status: 'open' },
        { id: 'b', status: 'open', discussion_id: 'd1' },
        { id: 'c', status: 'optional', discussion_id: 'fyi' },
        { id: 'd', status: 'fixed', discussion_id: 'd2' },
        { id: 'e', status: 'open' },
      ],
      deepening: { module: 'x' },
    })
    expect(summary.split('\n')).toContain('postable: 2 open without a thread · 1 optional · deepening yes')
  })
})
