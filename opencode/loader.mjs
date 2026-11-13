import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN_NAME = 'jig'
const ENTRY = ['opencode', 'jig.mjs']

const cacheMarketplace = (root, claudeDir) => {
  const parts = relative(join(claudeDir, 'plugins', 'cache'), root).split(sep)
  if (parts.length < 3 || parts[0] === '..' || parts[0] === '' || parts[1] !== PLUGIN_NAME) return undefined
  return parts[0]
}

export const resolveRoot = (pinned, env = process.env, home = homedir()) => {
  try {
    const claudeDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
    const marketplace = cacheMarketplace(pinned, claudeDir)
    if (marketplace === undefined) return pinned
    const installed = JSON.parse(readFileSync(join(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8'))
    const entries = installed?.plugins?.[`${PLUGIN_NAME}@${marketplace}`]
    const current = (Array.isArray(entries) ? entries : []).map((entry) => entry?.installPath).find((path) => typeof path === 'string' && existsSync(join(path, ...ENTRY)))
    return current ?? pinned
  } catch {
    return pinned
  }
}

export const loadJig = async (pinned) => {
  const root = resolveRoot(pinned)
  try {
    return (await import(pathToFileURL(join(root, ...ENTRY)).href)).JigPlugin
  } catch (error) {
    if (root === pinned) throw error
    return (await import(pathToFileURL(join(pinned, ...ENTRY)).href)).JigPlugin
  }
}
