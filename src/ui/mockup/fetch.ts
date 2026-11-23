import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ensureJigDir } from '../../core/paths'
import { hasNodes } from './export'

export const FIGMA_KEY_ENVS = ['JIG_FIGMA_API_KEY', 'FIGMA_API_KEY'] as const
const FETCH_BUFFER = 256 * 1024 * 1024

export class FigmaFetchError extends Error {}

export const figmaApiKey = (env: NodeJS.ProcessEnv = process.env): string | undefined =>
  FIGMA_KEY_ENVS.map((name) => env[name]).find((value) => value !== undefined && value !== '')

export const parseFigmaUrl = (url: string): { fileKey: string; nodeId: string } => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new FigmaFetchError(`${url}: not a URL`)
  }
  const fileKey = /\/(?:design|file|proto|board)\/([^/]+)/.exec(parsed.pathname)?.[1]
  const nodeId = parsed.searchParams.get('node-id')?.replace(/-/g, ':')
  if (fileKey === undefined || nodeId === undefined || nodeId === '') throw new FigmaFetchError(`${url}: need a Figma URL with /design/<file>/ and ?node-id=`)
  return { fileKey, nodeId }
}

export const exportPathFor = (root: string, url: string): string => {
  const { fileKey, nodeId } = parseFigmaUrl(url)
  return join(ensureJigDir(root).ui, 'figma', `${fileKey}-${nodeId.replace(/:/g, '-')}.yaml`)
}

export interface FetchOptions {
  root: string
  url: string
  env?: NodeJS.ProcessEnv
  log: (text: string) => void
}

export const fetchExport = ({ root, url, env = process.env, log }: FetchOptions): string => {
  const file = exportPathFor(root, url)
  if (existsSync(file)) return file
  const key = figmaApiKey(env)
  if (key === undefined) throw new FigmaFetchError(`no Figma key: set ${FIGMA_KEY_ENVS.join(' or ')}, or pass an existing export with --export <file>`)
  const { fileKey, nodeId } = parseFigmaUrl(url)
  const isWindows = process.platform === 'win32'
  const fetched = spawnSync(
    isWindows ? 'npx.cmd' : 'npx',
    ['-y', 'figma-developer-mcp', 'fetch', '--no-telemetry', '--format', 'tree', '--file-key', fileKey, '--node-id', nodeId],
    { cwd: tmpdir(), encoding: 'utf8', maxBuffer: FETCH_BUFFER, env: { ...env, FIGMA_API_KEY: key }, shell: isWindows, windowsHide: true },
  )
  if (fetched.status !== 0 || !hasNodes(fetched.stdout ?? '')) {
    throw new FigmaFetchError(`figma fetch failed:\n${(fetched.stderr ?? '').slice(-2000)}`)
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, fetched.stdout)
  log(`saved ${file}\n`)
  return file
}
