import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADAPTERS, resolveAdapter } from '../src/adapters'
import { parseHookArgs } from '../src/hook/dispatch'

const bin = join(resolve(__dirname, '..'), 'bin', 'jig.mjs')

describe('adapter selection', () => {
  it('picks claude when no --agent is given', () => {
    const { name, adapter } = parseHookArgs(['pre-edit'])
    expect(name).toBe('pre-edit')
    expect(adapter).toBe(ADAPTERS['claude'])
  })

  it('picks the adapter named by --agent wherever the flag stands', () => {
    expect(parseHookArgs(['--agent', 'claude', 'stop'])).toEqual({ name: 'stop', adapter: resolveAdapter('claude') })
    expect(parseHookArgs(['stop', '--agent', 'claude'])).toEqual({ name: 'stop', adapter: resolveAdapter('claude') })
  })

  it('rejects an unknown agent name and a missing one', () => {
    expect(() => parseHookArgs(['stop', '--agent', 'toString'])).toThrow('unknown agent toString, expected one of: claude')
    expect(() => parseHookArgs(['stop', '--agent'])).toThrow('--agent needs an agent name')
  })

  it('exits with one error line for an unknown agent', () => {
    const result = spawnSync(process.execPath, [bin, 'hook', 'stop', '--agent', 'nope'], { input: '{}', encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('jig: unknown agent nope, expected one of: claude\n')
  })
})
