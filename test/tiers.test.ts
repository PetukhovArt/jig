import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectAgent, loadUserConfig, resolveTiers, runTiers } from '../src/tiers/tiers'

const dirs: string[] = []

const userConfigFile = (text: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'jig-tiers-'))
  dirs.push(dir)
  const path = join(dir, 'config.jsonc')
  writeFileSync(path, text)
  return path
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('resolveTiers', () => {
  it('replaces the built-in default per tier key, not per agent', () => {
    const tiers = resolveTiers('claude', { tiers: { claude: { fast: ['sonnet'] } } })
    expect(tiers).toEqual({ deep: ['opus', 'sonnet'], standard: ['sonnet'], fast: ['sonnet'] })
  })
})

describe('loadUserConfig', () => {
  it.each([
    ['unknown root key', '{ "tier": {} }', '$.tier: unknown key'],
    ['unknown tier', '{ "tiers": { "claude": { "huge": ["opus"] } } }', '$.tiers.claude.huge: unknown key'],
    ['empty models', '{ "tiers": { "codex": { "fast": [] } } }', '$.tiers.codex.fast: expected a non-empty array of strings'],
    ['non-kebab agent', '{ "tiers": { "Claude": {} } }', '$.tiers.Claude: expected a kebab-case agent id'],
  ])('reports %s with its path', (_name, text, error) => {
    expect(loadUserConfig({ JIG_USER_CONFIG: userConfigFile(text) }).error).toBe(error)
  })
})

describe('detectAgent', () => {
  it('prefers the flag over the environment', () => {
    expect(detectAgent('codex', { CLAUDECODE: '1' })).toBe('codex')
  })

  it('prefers claude when Claude Code runs inside a Cursor terminal', () => {
    expect(detectAgent(undefined, { CURSOR_AGENT: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('claude')
  })
})

describe('runTiers', () => {
  it('tells an agent without a mapping to choose by tier', () => {
    vi.stubEnv('JIG_USER_CONFIG', join(tmpdir(), 'jig-tiers-absent', 'config.jsonc'))
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    expect(runTiers(['--agent', 'cursor'])).toBe(0)
    expect(write).toHaveBeenCalledWith(
      'agent: cursor\nno mapping: choose a model that fits the tier (deep = strongest reasoning, standard = balanced, fast = cheap mechanical work)\n',
    )
  })
})
