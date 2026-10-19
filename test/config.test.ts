import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OUTPUT_FORMATS, PROOF_NAMES, TOOL_NAMES } from '../src/catalog'
import { defaultRules, enabledSetting, loadConfig, mergeConfigValues, parseConfig, validateConfig } from '../src/core/config'

const example = readFileSync(join(import.meta.dirname, 'fixtures', 'core', 'config.example.jsonc'), 'utf8')

const errorsOf = (value: unknown): string[] => validateConfig(value).errors

describe('parseConfig', () => {
  it('accepts the example from schemas.md', () => {
    const config = parseConfig(example)
    expect(config.error).toBeUndefined()
    expect(config.rules['jig/comments']).toBe('error')
    expect(config.tools).toEqual({
      tsc: { level: 'error', command: 'vue-tsc', ignoreRules: [] },
      eslint: { level: 'error', ignoreRules: ['boundaries/*'] },
      oxlint: false,
      stratum: { level: 'warn', ignoreRules: [] },
    })
    expect(config.proofs).toEqual({ 'agent-view': { level: 'error', ignoreRules: [] } })
    expect(config.checks).toEqual([
      { name: 'unit', files: ['src/**/*.ts'], on: 'stop', run: 'vitest related --run {files}', format: 'exit', level: 'error' },
    ])
    expect(config.slots).toEqual({
      worktreesDir: '..',
      install: 'npm ci --prefer-offline --no-audit --no-fund',
      dev: 'npm run dev',
      runtime: 'electron',
      ports: { VITE_SERVER_PORT: { base: 3000, step: 10, target: '.env' } },
      cdp: { base: 9900, step: 1 },
      clearCache: [],
    })
    expect(config.worktree).toEqual({ seedExclude: ['*.log'], copyFiles: ['node_modules/.cache/keep.json'] })
  })

  it('fills missing rules with the default level and keeps given ones', () => {
    const config = parseConfig('{ "rules": { "jig/comments": "warn" } }')
    expect(config.rules).toEqual({ ...defaultRules(), 'jig/comments': 'warn' })
  })

  it('runs nothing that the config does not name', () => {
    const config = parseConfig('{}')
    expect(config.tools).toEqual({})
    expect(config.proofs).toEqual({})
    expect(config.checks).toEqual([])
  })

  it('defaults the port target to .env', () => {
    const config = parseConfig('{ "slots": { "worktreesDir": "..", "ports": { "P": { "base": 1, "step": 1 } } } }')
    expect(config.slots?.ports?.['P']?.target).toBe('.env')
  })

  it('falls back to defaults with an error on invalid config', () => {
    const config = parseConfig('{ "rules": { "jig/comments": "warn", "jig/unknown": "error" }, "tools": { "eslint": {} } }')
    expect(config.error).toBe('$.rules["jig/unknown"]: unknown key')
    expect(config.rules).toEqual(defaultRules())
    expect(config.tools).toEqual({})
  })

  it('reports a JSONC syntax error at the root', () => {
    expect(parseConfig('{ "rules": ').error).toMatch(/^\$: /)
  })
})

describe('validateConfig', () => {
  it.each([
    ['unknown root key', { rule: {} }, ['$.rule: unknown key']],
    ['unknown rule', { rules: { 'jig/foo': 'error' } }, ['$.rules["jig/foo"]: unknown key']],
    ['tool levels moved out of rules', { rules: { 'gate/tsc': 'off' } }, ['$.rules["gate/tsc"]: unknown key']],
    ['wrong severity', { rules: { 'jig/tests': 'fatal' } }, ['$.rules["jig/tests"]: expected one of off, warn, error']],
    ['rules not an object', { rules: [] }, ['$.rules: expected an object']],
    ['root not an object', 'x', ['$: expected an object']],
    ['tool outside the catalog', { tools: { ruff: {} } }, ['$.tools.ruff: unknown name, the catalog has oxlint, tsc, eslint, stratum']],
    ['proof outside the catalog', { proofs: { eslint: {} } }, ['$.proofs.eslint: unknown name, the catalog has agent-view']],
    ['tool true', { tools: { eslint: true } }, ['$.tools.eslint: expected an object']],
    ['tool unknown key', { tools: { eslint: { config: 'x' } } }, ['$.tools.eslint.config: unknown key']],
    ['tool wrong level', { tools: { eslint: { level: 'fatal' } } }, ['$.tools.eslint.level: expected one of off, warn, error']],
    ['tool empty command', { tools: { tsc: { command: ' ' } } }, ['$.tools.tsc.command: is empty']],
    ['ignoreRules not strings', { tools: { eslint: { ignoreRules: [1] } } }, ['$.tools.eslint.ignoreRules[0]: expected a string']],
    ['checks not an array', { checks: {} }, ['$.checks: expected an array']],
    ['check missing run', { checks: [{ name: 'a', files: ['**'], on: 'stop' }] }, ['$.checks[0].run: is required']],
    ['check without {files}', { checks: [{ name: 'a', files: ['**'], on: 'stop', run: 'lint' }] }, ['$.checks[0].run: needs the {files} placeholder']],
    ['check wrong stage', { checks: [{ name: 'a', files: ['**'], on: 'commit', run: 'x {files}' }] }, ['$.checks[0].on: expected one of edit, stop']],
    ['check unknown format', { checks: [{ name: 'a', files: ['**'], on: 'stop', run: 'x {files}', format: 'sarif' }] }, ['$.checks[0].format: expected one of exit, jsonl, oxlint, tsc, eslint, stratum']],
    ['check bad name', { checks: [{ name: 'a b', files: ['**'], on: 'stop', run: 'x {files}' }] }, ['$.checks[0].name: expected letters, digits, ".", "_" or "-"']],
    [
      'duplicate check',
      { checks: [{ name: 'a', files: ['**'], on: 'stop', run: 'x {files}' }, { name: 'a', files: ['**'], on: 'edit', run: 'y {files}' }] },
      ['$.checks[1].name: duplicate check a'],
    ],
    ['missing worktreesDir', { slots: {} }, ['$.slots.worktreesDir: is required']],
    ['unknown slots key', { slots: { worktreesDir: '..', extra: 1 } }, ['$.slots.extra: unknown key']],
    ['wrong runtime', { slots: { worktreesDir: '..', runtime: 'deno' } }, ['$.slots.runtime: expected one of electron, tauri, browser, none']],
    ['verifyRuntime none', { slots: { worktreesDir: '..', verifyRuntime: 'none' } }, ['$.slots.verifyRuntime: expected one of electron, tauri, browser']],
    ['port out of range', { slots: { worktreesDir: '..', ports: { P: { base: 70000, step: 1 } } } }, ['$.slots.ports.P.base: expected an integer 1..65535']],
    ['port step zero', { slots: { worktreesDir: '..', ports: { P: { base: 3000, step: 0 } } } }, ['$.slots.ports.P.step: expected an integer >= 1']],
    ['port missing step', { slots: { worktreesDir: '..', ports: { P: { base: 3000 } } } }, ['$.slots.ports.P.step: is required']],
    ['port unknown key', { slots: { worktreesDir: '..', ports: { P: { base: 3000, step: 1, x: 1 } } } }, ['$.slots.ports.P.x: unknown key']],
    ['cdp fractional base', { slots: { worktreesDir: '..', cdp: { base: 9900.5, step: 1 } } }, ['$.slots.cdp.base: expected an integer 1..65535']],
    ['copyFiles item not a string', { worktree: { copyFiles: ['a', 2] } }, ['$.worktree.copyFiles[1]: expected a string']],
    ['copyFiles moved out of slots', { slots: { worktreesDir: '..', copyFiles: [] } }, ['$.slots.copyFiles: unknown key']],
    ['instance not an object', { slots: { worktreesDir: '..', instance: 1 } }, ['$.slots.instance: expected an object']],
    ['$schema not a string', { $schema: 1 }, ['$.$schema: expected a string']],
  ])('%s', (_name, value, expected) => {
    expect(errorsOf(value)).toEqual(expected)
  })

  it('collects every error', () => {
    expect(errorsOf({ rules: { 'jig/tests': 'x', 'jig/comments': 'y' }, foo: 1 })).toHaveLength(3)
  })
})

describe('schema/config.schema.json', () => {
  const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'schema', 'config.schema.json'), 'utf8'))

  it('names the same tools, proofs and check formats as the catalog', () => {
    expect(Object.keys(schema.properties.tools.properties)).toEqual(TOOL_NAMES)
    expect(Object.keys(schema.properties.proofs.properties)).toEqual(PROOF_NAMES)
    expect(schema.properties.checks.items.properties.format.enum).toEqual(OUTPUT_FORMATS)
  })
})

describe('enabledSetting', () => {
  const { config } = validateConfig({ tools: { eslint: {}, oxlint: false, stratum: { level: 'off' } } })

  it('returns the settings of a tool the config turns on', () => {
    expect(enabledSetting(config.tools, 'eslint')).toEqual({ level: 'error', ignoreRules: [] })
  })

  it.each(['oxlint', 'stratum', 'tsc'])('treats %s as off: false, level off, or not named', (name) => {
    expect(enabledSetting(config.tools, name)).toBeUndefined()
  })
})

describe('mergeConfigValues', () => {
  it('merges objects by key and lets local values replace shared ones', () => {
    const shared = { tools: { eslint: { ignoreRules: ['a/*'] }, tsc: {} }, slots: { worktreesDir: '..', dev: 'npm run dev' } }
    const local = { tools: { eslint: { level: 'warn' }, tsc: false }, slots: { dev: 'pnpm dev' } }
    expect(mergeConfigValues(shared, local)).toEqual({
      tools: { eslint: { ignoreRules: ['a/*'], level: 'warn' }, tsc: false },
      slots: { worktreesDir: '..', dev: 'pnpm dev' },
    })
  })

  it('replaces arrays other than checks', () => {
    expect(mergeConfigValues({ tools: { eslint: { ignoreRules: ['a/*'] } } }, { tools: { eslint: { ignoreRules: [] } } })).toEqual({
      tools: { eslint: { ignoreRules: [] } },
    })
  })

  it('merges checks by name: a local check replaces the shared one of its name', () => {
    const shared = { checks: [{ name: 'unit', run: 'a {files}' }, { name: 'lint', run: 'b {files}' }] }
    const local = { checks: [{ name: 'unit', run: 'c {files}' }, { name: 'mine', run: 'd {files}' }] }
    expect(mergeConfigValues(shared, local)).toEqual({
      checks: [{ name: 'lint', run: 'b {files}' }, { name: 'unit', run: 'c {files}' }, { name: 'mine', run: 'd {files}' }],
    })
  })
})

describe('loadConfig', () => {
  let root: string | undefined

  const project = (files: Record<string, string>): string => {
    root = mkdtempSync(join(tmpdir(), 'jig-config-'))
    mkdirSync(join(root, '.jig'))
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(root, '.jig', name), text)
    }
    return root
  }

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it('uses defaults without slots when the file is missing', () => {
    expect(loadConfig(project({}))).toEqual({ rules: defaultRules(), tools: {}, proofs: {}, checks: [], files: [] })
  })

  it('reads .jig/config.jsonc', () => {
    const config = loadConfig(project({ 'config.jsonc': example }))
    expect(config.slots?.worktreesDir).toBe('..')
    expect(config.files).toEqual([join(root ?? '', '.jig', 'config.jsonc')])
  })

  it('lays .jig/config.local.jsonc over the shared config', () => {
    const local = '{ "tools": { "stratum": false, "eslint": { "level": "warn" } }, "slots": { "dev": "pnpm dev" } }'
    const config = loadConfig(project({ 'config.jsonc': example, 'config.local.jsonc': local }))
    expect(config.error).toBeUndefined()
    expect(config.tools['stratum']).toBe(false)
    expect(config.tools['eslint']).toEqual({ level: 'warn', ignoreRules: ['boundaries/*'] })
    expect(config.slots?.dev).toBe('pnpm dev')
    expect(config.slots?.worktreesDir).toBe('..')
    expect(config.files).toHaveLength(2)
  })

  it('reads a local config alone', () => {
    const config = loadConfig(project({ 'config.local.jsonc': '{ "tools": { "eslint": {} } }' }))
    expect(enabledSetting(config.tools, 'eslint')).toBeDefined()
  })

  it('names the file whose JSONC is broken', () => {
    const config = loadConfig(project({ 'config.jsonc': '{}', 'config.local.jsonc': '{ "tools": ' }))
    expect(config.error).toMatch(/^\.jig\/config\.local\.jsonc: \$: /)
    expect(config.tools).toEqual({})
  })
})
