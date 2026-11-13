import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runHooks } from '../src/adapters/install'

const repo = resolve(__dirname, '..')
const loaderUrl = pathToFileURL(join(repo, 'opencode', 'loader.mjs')).href

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jig-opencode-install-'))
  vi.stubEnv('OPENCODE_CONFIG_DIR', join(dir, 'config'))
  vi.stubEnv('CLAUDE_PLUGIN_ROOT', repo)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

it('installs a loader whose plugin registers every jig skill and the tier agents, and uninstalls only its own file', async () => {
  const path = join(dir, 'config', 'plugin', 'jig.js')
  runHooks(['opencode', '--install'])
  const { JigPlugin } = await import(pathToFileURL(path).href)
  const hooks = await JigPlugin({ client: {}, directory: dir, worktree: dir })
  const config: { skills?: { paths: string[] }; agent?: Record<string, { mode: string }>; subagent_depth?: number } = {
    skills: { paths: ['mine'] },
    agent: { 'jig-fast': { mode: 'primary' } },
  }
  await hooks.config(config)
  const manifest = JSON.parse(readFileSync(join(repo, '.claude-plugin', 'plugin.json'), 'utf8')) as { skills: string[] }
  expect(config.skills?.paths).toEqual(['mine', ...manifest.skills.map((skill) => join(repo, skill))])
  expect(Object.keys(config.agent ?? {}).sort()).toEqual(['jig-deep', 'jig-fast', 'jig-standard'])
  expect(config.agent?.['jig-fast']?.mode).toBe('primary')
  expect(config.subagent_depth).toBe(2)

  runHooks(['opencode', '--uninstall'])
  expect(existsSync(path)).toBe(false)
  writeFileSync(path, 'export const Mine = async () => ({})\n')
  runHooks(['opencode', '--uninstall'])
  expect(existsSync(path)).toBe(true)
})

it('resolves a plugin-cache root to the current installPath, and falls back to the pinned root', async () => {
  const { resolveRoot } = await import(loaderUrl)
  const claude = join(dir, 'claude')
  const cache = (version: string): string => join(claude, 'plugins', 'cache', 'market', 'jig', version)
  const current = cache('0.6.0')
  mkdirSync(join(current, 'opencode'), { recursive: true })
  writeFileSync(join(current, 'opencode', 'jig.mjs'), '')
  const env = { CLAUDE_CONFIG_DIR: claude }
  expect(resolveRoot(cache('0.5.0'), env)).toBe(cache('0.5.0'))
  writeFileSync(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'jig@market': [{ installPath: current }] } }))
  expect(resolveRoot(cache('0.5.0'), env)).toBe(current)
  expect(resolveRoot(join(dir, 'checkout'), env)).toBe(join(dir, 'checkout'))
  writeFileSync(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'jig@market': [{ installPath: cache('0.7.0') }] } }))
  expect(resolveRoot(cache('0.5.0'), env)).toBe(cache('0.5.0'))
})
