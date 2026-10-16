import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRules, loadConfig, parseConfig, validateConfig } from '../src/core/config'

const example = readFileSync(join(import.meta.dirname, 'fixtures', 'core', 'config.example.jsonc'), 'utf8')

const errorsOf = (value: unknown): string[] => validateConfig(value).errors

describe('parseConfig', () => {
  it('accepts the example from schemas.md', () => {
    const config = parseConfig(example)
    expect(config.error).toBeUndefined()
    expect(config.rules['gate/eslint']).toBe('error')
    expect(config.slots).toEqual({
      worktreesDir: '..',
      install: 'npm ci --prefer-offline --no-audit --no-fund',
      dev: 'npm run dev',
      runtime: 'electron',
      ports: { VITE_SERVER_PORT: { base: 3000, step: 10, target: '.env' } },
      cdp: { base: 9900, step: 1 },
      copyFiles: ['.env.local'],
      clearCache: [],
    })
  })

  it('fills missing rules with the default level and keeps given ones', () => {
    const config = parseConfig('{ "rules": { "jig/comments": "warn", "gate/tsc": "off" } }')
    expect(config.rules).toEqual({ ...defaultRules(), 'jig/comments': 'warn', 'gate/tsc': 'off' })
  })

  it('defaults the port target to .env', () => {
    const config = parseConfig('{ "slots": { "worktreesDir": "..", "ports": { "P": { "base": 1, "step": 1 } } } }')
    expect(config.slots?.ports?.['P']?.target).toBe('.env')
  })

  it('falls back to defaults with an error on invalid config', () => {
    const config = parseConfig('{ "rules": { "jig/comments": "warn", "jig/unknown": "error" }, "slots": { "worktreesDir": ".." } }')
    expect(config.error).toBe('$.rules["jig/unknown"]: unknown key')
    expect(config.rules).toEqual(defaultRules())
    expect(config.slots).toBeUndefined()
  })

  it('reports a JSONC syntax error at the root', () => {
    expect(parseConfig('{ "rules": ').error).toMatch(/^\$: /)
  })
})

describe('validateConfig', () => {
  it.each([
    ['unknown root key', { rule: {} }, ['$.rule: unknown key']],
    ['unknown rule', { rules: { 'jig/foo': 'error' } }, ['$.rules["jig/foo"]: unknown key']],
    ['wrong severity', { rules: { 'gate/tsc': 'fatal' } }, ['$.rules["gate/tsc"]: expected one of off, warn, error']],
    ['rules not an object', { rules: [] }, ['$.rules: expected an object']],
    ['root not an object', 'x', ['$: expected an object']],
    ['missing worktreesDir', { slots: {} }, ['$.slots.worktreesDir: is required']],
    ['unknown slots key', { slots: { worktreesDir: '..', extra: 1 } }, ['$.slots.extra: unknown key']],
    ['wrong runtime', { slots: { worktreesDir: '..', runtime: 'deno' } }, ['$.slots.runtime: expected one of electron, tauri, browser, none']],
    ['verifyRuntime none', { slots: { worktreesDir: '..', verifyRuntime: 'none' } }, ['$.slots.verifyRuntime: expected one of electron, tauri, browser']],
    ['port out of range', { slots: { worktreesDir: '..', ports: { P: { base: 70000, step: 1 } } } }, ['$.slots.ports.P.base: expected an integer 1..65535']],
    ['port step zero', { slots: { worktreesDir: '..', ports: { P: { base: 3000, step: 0 } } } }, ['$.slots.ports.P.step: expected an integer >= 1']],
    ['port missing step', { slots: { worktreesDir: '..', ports: { P: { base: 3000 } } } }, ['$.slots.ports.P.step: is required']],
    ['port unknown key', { slots: { worktreesDir: '..', ports: { P: { base: 3000, step: 1, x: 1 } } } }, ['$.slots.ports.P.x: unknown key']],
    ['cdp fractional base', { slots: { worktreesDir: '..', cdp: { base: 9900.5, step: 1 } } }, ['$.slots.cdp.base: expected an integer 1..65535']],
    ['copyFiles item not a string', { slots: { worktreesDir: '..', copyFiles: ['a', 2] } }, ['$.slots.copyFiles[1]: expected a string']],
    ['instance not an object', { slots: { worktreesDir: '..', instance: 1 } }, ['$.slots.instance: expected an object']],
    ['$schema not a string', { $schema: 1 }, ['$.$schema: expected a string']],
  ])('%s', (_name, value, expected) => {
    expect(errorsOf(value)).toEqual(expected)
  })

  it('collects every error', () => {
    expect(errorsOf({ rules: { 'gate/tsc': 'x', 'gate/eslint': 'y' }, foo: 1 })).toHaveLength(3)
  })
})

describe('loadConfig', () => {
  let root: string | undefined

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it('uses defaults without slots when the file is missing', () => {
    root = mkdtempSync(join(tmpdir(), 'jig-config-'))
    expect(loadConfig(root)).toEqual({ rules: defaultRules() })
  })

  it('reads .jig/config.jsonc', () => {
    root = mkdtempSync(join(tmpdir(), 'jig-config-'))
    mkdirSync(join(root, '.jig'))
    writeFileSync(join(root, '.jig', 'config.jsonc'), example)
    expect(loadConfig(root).slots?.worktreesDir).toBe('..')
  })
})
