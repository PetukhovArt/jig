import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type JigConfig, type ToolSetting } from '../src/core/config'
import { ensureJigDir } from '../src/core/paths'
import type { Plan } from '../src/core/plan'
import { checkEdit } from '../src/gates/edit'
import { runStopChecks } from '../src/gates/stop'
import type { Finding } from '../src/tools/finding'

const registry = vi.hoisted(() => ({ calls: [] as string[], failing: new Set<string>(), files: [] as string[][] }))

vi.mock('../src/catalog/tools', () => {
  const finding = (tool: string, rule = `${tool}-rule`): Finding => ({ tool, rule, severity: 'error', file: 'src/a.ts', line: 1, message: tool })
  const stopTool = (name: string, files: string[] = ['**']) => ({
    name,
    rule: `gate/${name}`,
    binaries: [],
    files,
    stop: async (_tools: unknown, input: { files: readonly string[] }) => {
      registry.calls.push(name)
      registry.files.push([...input.files])
      return { runs: [], findings: registry.failing.has(name) ? [finding(name), finding(name, 'boundaries/element-types')] : [] }
    },
  })
  const editTool = {
    name: 'gamma',
    rule: 'gate/gamma',
    binaries: [],
    files: ['**/*.ts'],
    edit: async () => ({ tool: 'gamma', findings: [finding('gamma')], durationMs: 0 }),
  }
  return { DIRECTIVE_SOURCES: [], TOOLS: [stopTool('beta'), editTool, stopTool('alpha'), stopTool('styles', ['**/*.css'])] }
})

let root: string

const ON: ToolSetting = { level: 'error', ignoreRules: [] }

const plan = (tools: Record<string, ToolSetting>, extra: Partial<JigConfig> = {}): Plan => ({
  v: 2,
  inputsHash: '',
  pluginVersion: '',
  builtAt: '',
  config: { ...defaultConfig(), tools, files: [], ...extra },
  tools: {},
  unresolved: [],
  drift: [],
  atoms: [],
})

const ALL_ON = { beta: ON, gamma: ON, alpha: ON, styles: ON }

const stopChecks = (tools: Record<string, ToolSetting> = ALL_ON) =>
  runStopChecks({ projectRoot: root, pluginRoot: root, plan: plan(tools), diff: { files: ['src/a.ts'], stamps: {}, fingerprint: '', foreign: [] } })

const stopRules = async (tools: Record<string, ToolSetting> = ALL_ON): Promise<string[]> => (await stopChecks(tools)).steps.map((step) => step.rule)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-registry-'))
  ensureJigDir(root)
  registry.calls = []
  registry.files = []
  registry.failing.clear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('gates read tools from the catalog and the config', () => {
  it('runs stop steps in catalog order and skips tools without a stop stage', async () => {
    expect(await stopRules()).toEqual(['gate/beta', 'gate/alpha', 'gate/styles'])
    expect(registry.calls).toEqual(['beta', 'alpha'])
  })

  it('passes a tool only the files its catalog patterns match', async () => {
    await stopRules()
    expect(registry.calls).not.toContain('styles')
    expect(registry.files).toEqual([['src/a.ts'], ['src/a.ts']])
  })

  it('stops after the first tool with an error', async () => {
    registry.failing.add('beta')
    expect(await stopRules()).toEqual(['gate/beta'])
    expect(registry.calls).toEqual(['beta'])
  })

  it.each([
    ['not named', { alpha: ON }],
    ['false', { beta: false, alpha: ON }],
    ['level off', { beta: { ...ON, level: 'off' }, alpha: ON }],
  ] satisfies [string, Record<string, ToolSetting>][])('does not run a tool the config leaves %s', async (_name, tools) => {
    await stopRules(tools)
    expect(registry.calls).toEqual(['alpha'])
  })

  it('downgrades findings of a warn tool so they no longer block', async () => {
    registry.failing.add('beta')
    const checks = await stopChecks({ beta: { level: 'warn', ignoreRules: [] }, alpha: ON })
    expect(checks.blocking).toEqual([])
    expect(checks.findings.map((finding) => finding.severity)).toEqual(['warn', 'warn'])
  })

  it('drops findings whose rule matches ignoreRules', async () => {
    registry.failing.add('beta')
    const checks = await stopChecks({ beta: { level: 'error', ignoreRules: ['boundaries/*'] } })
    expect(checks.findings.map((finding) => finding.rule)).toEqual(['beta-rule'])
  })

  it('runs the edit stage of named tools on matching files only', async () => {
    expect((await checkEdit(plan(ALL_ON), root, 'src/a.ts')).map((toolRun) => toolRun.tool)).toEqual(['gamma'])
    expect(await checkEdit(plan(ALL_ON), root, 'src/a.css')).toEqual([])
    expect(await checkEdit(plan({ beta: ON }), root, 'src/a.ts')).toEqual([])
  })
})
