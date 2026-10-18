import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../src/core/config'
import { ensureJigDir } from '../src/core/paths'
import type { Plan } from '../src/core/plan'
import { checkEdit } from '../src/gates/edit'
import { runStopChecks } from '../src/gates/stop'
import type { Finding } from '../src/tools/finding'

const registry = vi.hoisted(() => ({ calls: [] as string[], failing: new Set<string>() }))

vi.mock('../src/tools', () => {
  const finding = (tool: string): Finding => ({ tool, rule: `${tool}-rule`, severity: 'error', file: 'src/a.ts', line: 1, message: tool })
  const stopTool = (name: string) => ({
    name,
    rule: `gate/${name}`,
    binaries: [],
    stop: async () => {
      registry.calls.push(name)
      return { runs: [], findings: registry.failing.has(name) ? [finding(name)] : [] }
    },
  })
  const editTool = {
    name: 'gamma',
    rule: 'gate/gamma',
    binaries: [],
    edit: async () => ({ tool: 'gamma', findings: [finding('gamma')], durationMs: 0 }),
  }
  return { TOOLS: [stopTool('beta'), editTool, stopTool('alpha')] }
})

let root: string

const plan = (): Plan => ({ v: 1, inputsHash: '', pluginVersion: '', builtAt: '', config: defaultConfig(), tools: {}, atoms: [] })

const stopRules = async (): Promise<string[]> => {
  const checks = await runStopChecks({ projectRoot: root, pluginRoot: root, plan: plan(), diff: { files: ['src/a.ts'], stamps: {}, fingerprint: '' } })
  return checks.steps.map((step) => step.rule)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-registry-'))
  ensureJigDir(root)
  registry.calls = []
  registry.failing.clear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('gates read tools from the registry', () => {
  it('runs stop steps in registry order and skips tools without a stop stage', async () => {
    expect(await stopRules()).toEqual(['gate/beta', 'gate/alpha'])
    expect(registry.calls).toEqual(['beta', 'alpha'])
  })

  it('stops after the first registry tool with an error', async () => {
    registry.failing.add('beta')
    expect(await stopRules()).toEqual(['gate/beta'])
    expect(registry.calls).toEqual(['beta'])
  })

  it('runs the edit stage of registry tools and knows their rule ids', async () => {
    const config = defaultConfig()
    expect(Object.keys(config.rules)).toEqual(expect.arrayContaining(['gate/beta', 'gate/gamma', 'gate/alpha']))
    const runs = await checkEdit(plan(), root, 'src/a.ts')
    expect(runs.map((toolRun) => toolRun.tool)).toEqual(['gamma'])
  })
})
