import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gitToplevel } from './git'

export interface JigPaths {
  dir: string
  config: string
  gitignore: string
  journal: string
  runs: string
  cache: string
  sessions: string
  plan: string
  heavyLock: string
  tscCache: string
  eslintCache: string
}

const JIG_GITIGNORE = 'journal/\nruns/\ncache/\n'

export const resolveProjectRoot = (cwd: string, env: NodeJS.ProcessEnv = process.env): string => {
  const fromEnv = env['CLAUDE_PROJECT_DIR']
  if (fromEnv) return resolve(fromEnv)
  return resolve(gitToplevel(cwd) ?? cwd)
}

export const resolvePluginRoot = (
  env: NodeJS.ProcessEnv = process.env,
  entry: string | undefined = process.argv[1],
): string => {
  const fromEnv = env['CLAUDE_PLUGIN_ROOT']
  if (fromEnv) return resolve(fromEnv)
  if (entry === undefined) return process.cwd()
  return dirname(dirname(resolve(entry)))
}

export const jigPaths = (projectRoot: string): JigPaths => {
  const dir = join(projectRoot, '.jig')
  const cache = join(dir, 'cache')
  return {
    dir,
    config: join(dir, 'config.jsonc'),
    gitignore: join(dir, '.gitignore'),
    journal: join(dir, 'journal'),
    runs: join(dir, 'runs'),
    cache,
    sessions: join(cache, 'sessions'),
    plan: join(cache, 'plan.json'),
    heavyLock: join(cache, 'heavy.lock'),
    tscCache: join(cache, 'tsc'),
    eslintCache: join(cache, 'eslint'),
  }
}

export const ensureJigDir = (projectRoot: string): JigPaths => {
  const paths = jigPaths(projectRoot)
  mkdirSync(paths.dir, { recursive: true })
  if (!existsSync(paths.gitignore)) {
    writeFileSync(paths.gitignore, JIG_GITIGNORE)
  }
  return paths
}

export const toSlash = (path: string): string => path.replace(/\\/g, '/')

export const toProjectPath = (projectRoot: string, file: string, cwd: string = projectRoot): string => {
  const absolute = isAbsolute(file) ? file : resolve(cwd, file)
  return toSlash(relative(projectRoot, absolute))
}
