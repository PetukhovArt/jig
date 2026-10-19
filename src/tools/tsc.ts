import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { matchGlob } from '../core/glob'
import { parseJsonc } from '../core/jsonc'
import { jigPaths, toProjectPath, toSlash } from '../core/paths'
import type { Finding } from './finding'
import { runDetachable, type DetachableRun } from './detach'
import { defineTool, keepOnChangedLines, type ToolBin, type ToolRun } from './tool'

interface TsconfigShape {
  files?: unknown
  include?: unknown
  references?: unknown
}

export interface TscGroup {
  config: string
  files: string[]
}

export interface TscGrouping {
  groups: TscGroup[]
  skipped: string[]
}

export interface TypeCheckers {
  tsc?: ToolBin
  vueTsc?: ToolBin
}

export const TYPED_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts', '.vue'])
export const TSCONFIG = 'tsconfig.json'
export const TYPES_TIMEOUT_MS = 60_000

const OK_CODES = [0, 1, 2]
const HASH_LENGTH = 12
const TSC_ERROR = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const GLOBAL_ERROR = /error TS\d+: .*/
const WILDCARD = /[*?]/
const DEFAULT_INCLUDE = ['**/*']

export const isTypedFile = (file: string): boolean => TYPED_EXTENSIONS.has(extname(file)) && !file.endsWith('.d.ts')

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const readTsconfig = (path: string): TsconfigShape => {
  const value = parseJsonc(readFileSync(path, 'utf8'))
  return typeof value === 'object' && value !== null ? (value as TsconfigShape) : {}
}

const stringsOf = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined

export const findNearestTsconfig = (projectRoot: string, file: string): string | undefined => {
  const top = resolve(projectRoot)
  let dir = dirname(resolve(projectRoot, file))
  for (;;) {
    const candidate = join(dir, TSCONFIG)
    if (isFile(candidate)) return candidate
    const isTop = relative(top, dir) === ''
    const parent = dirname(dir)
    if (isTop || parent === dir) return undefined
    dir = parent
  }
}

const toIncludeGlob = (pattern: string): string => {
  const clean = toSlash(pattern).replace(/^\.\//, '').replace(/\/$/, '')
  const lastSegment = clean.split('/').pop() ?? ''
  const isDirectory = !WILDCARD.test(clean) && !lastSegment.includes('.')
  return isDirectory ? `${clean}/**/*` : clean
}

const covers = (configPath: string, absoluteFile: string): boolean => {
  const config = readTsconfig(configPath)
  const path = toSlash(relative(dirname(configPath), absoluteFile))
  const files = stringsOf(config.files) ?? []
  if (files.some((entry) => toSlash(entry).replace(/^\.\//, '') === path)) return true
  const include = stringsOf(config.include) ?? (config.files === undefined ? DEFAULT_INCLUDE : [])
  return include.length > 0 && matchGlob(path, include.map(toIncludeGlob))
}

const referencePath = (fromConfig: string, reference: unknown): string | undefined => {
  const path = (reference as { path?: unknown } | null)?.path
  if (typeof path !== 'string') return undefined
  const target = resolve(dirname(fromConfig), path)
  return isFile(target) ? target : join(target, TSCONFIG)
}

const isSolutionConfig = (config: TsconfigShape): boolean =>
  Array.isArray(config.files) && config.files.length === 0 && Array.isArray(config.references)

export const selectTsconfig = (configPath: string, absoluteFile: string): string | undefined => {
  const config = readTsconfig(configPath)
  if (!isSolutionConfig(config)) return configPath
  for (const reference of config.references as unknown[]) {
    const target = referencePath(configPath, reference)
    if (target !== undefined && isFile(target) && covers(target, absoluteFile)) return target
  }
  return undefined
}

export const groupByTsconfig = (projectRoot: string, files: readonly string[]): TscGrouping => {
  const byConfig = new Map<string, string[]>()
  const skipped: string[] = []
  for (const file of files.filter(isTypedFile)) {
    const nearest = findNearestTsconfig(projectRoot, file)
    const selected = nearest === undefined ? undefined : selectTsconfig(nearest, resolve(projectRoot, file))
    if (selected === undefined) {
      skipped.push(file)
      continue
    }
    byConfig.set(selected, [...(byConfig.get(selected) ?? []), file])
  }
  return { groups: [...byConfig].map(([config, groupFiles]) => ({ config, files: groupFiles })), skipped }
}

export const tsconfigHash = (configPath: string): string =>
  createHash('sha1').update(configPath).digest('hex').slice(0, HASH_LENGTH)

export const closureConfig = (projectRoot: string, group: TscGroup): object => {
  const configDir = toSlash(dirname(group.config))
  const hash = tsconfigHash(group.config)
  return {
    extends: toSlash(group.config),
    files: group.files.map((file) => toSlash(resolve(projectRoot, file))),
    include: [`${configDir}/*.d.ts`, `${configDir}/src/**/*.d.ts`],
    compilerOptions: {
      noEmit: true,
      incremental: true,
      composite: false,
      tsBuildInfoFile: `${toSlash(jigPaths(projectRoot).tscCache)}/${hash}.tsbuildinfo`,
    },
  }
}

export const writeClosureConfig = (projectRoot: string, group: TscGroup): string => {
  const dir = jigPaths(projectRoot).tscCache
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `tsconfig.${tsconfigHash(group.config)}.json`)
  writeFileSync(path, `${JSON.stringify(closureConfig(projectRoot, group), null, 2)}\n`)
  return path
}

const pathKey = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path)

export const parseTscOutput = (
  stdout: string,
  tool: 'tsc' | 'vue-tsc',
  projectRoot: string,
  cwd: string = projectRoot,
): Finding[] =>
  stdout
    .split('\n')
    .map((line) => TSC_ERROR.exec(line.trimEnd()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, file = '', line = '1', , code = '', message = '']) => ({
      tool,
      rule: code,
      severity: 'error',
      file: toProjectPath(projectRoot, resolve(cwd, file)),
      line: Number(line),
      message,
    }))

export const keepGroupFindings = (findings: readonly Finding[], files: readonly string[]): Finding[] => {
  const keys = new Set(files.map(pathKey))
  return findings.filter((finding) => keys.has(pathKey(finding.file)))
}

const checkerFor = (checkers: TypeCheckers, group: TscGroup): { tool: 'tsc' | 'vue-tsc'; bin: string[]; files: string[] } | undefined => {
  const hasVue = group.files.some((file) => file.endsWith('.vue'))
  if (hasVue && checkers.vueTsc !== undefined) return { tool: 'vue-tsc', bin: checkers.vueTsc.bin, files: group.files }
  if (checkers.tsc === undefined) return undefined
  const files = group.files.filter((file) => !file.endsWith('.vue'))
  return files.length === 0 ? undefined : { tool: 'tsc', bin: checkers.tsc.bin, files }
}

export const runTypeCheck = async (
  checkers: TypeCheckers,
  projectRoot: string,
  group: TscGroup,
  timeoutMs: number,
  lockPath?: string,
): Promise<DetachableRun | undefined> => {
  const checker = checkerFor(checkers, group)
  if (checker === undefined) return undefined
  const config = writeClosureConfig(projectRoot, { config: group.config, files: checker.files })
  const argv = checker.tool === 'vue-tsc' ? [...checker.bin, '--noEmit', '-p', config] : [...checker.bin, '-p', config, '--pretty', 'false']
  return runDetachable({
    tool: checker.tool,
    argv,
    cwd: projectRoot,
    timeoutMs,
    outputPath: join(jigPaths(projectRoot).tscCache, `${tsconfigHash(group.config)}.out`),
    ...(lockPath === undefined ? {} : { lockPath }),
    okCodes: OK_CODES,
    parse: (stdout) => {
      const findings = parseTscOutput(stdout, checker.tool, projectRoot)
      const globalError = findings.length === 0 ? GLOBAL_ERROR.exec(stdout)?.[0] : undefined
      if (globalError !== undefined) throw new Error(globalError)
      return keepGroupFindings(findings, checker.files)
    },
  })
}

export const tscTool = defineTool({
  name: 'tsc',
  binaries: [
    { key: 'tsc', label: 'tsc', command: 'tsc', packages: ['typescript'], configs: [TSCONFIG], requiresConfig: false },
    { key: 'vueTsc', label: 'vue-tsc', command: 'vue-tsc', packages: ['vue-tsc'], configs: [], requiresConfig: false },
  ],
  comments: { suppressions: [/@ts-(?:ignore|expect-error|nocheck)\b/], allowed: [/^\/\/\/\s*<reference\b/] },
  stop: async (tools, input) => {
    const { groups, skipped } = groupByTsconfig(input.projectRoot, input.files)
    for (const file of skipped) {
      input.notes.push({ kind: 'gate-skipped', tool: 'jig', rule: 'gate/tsc', file, message: 'no tsconfig covers the file' })
    }
    const runs: ToolRun[] = []
    for (const group of groups) {
      const timeoutMs = input.budget(TYPES_TIMEOUT_MS)
      if (timeoutMs === 0) break
      const toolRun = await runTypeCheck(tools, input.projectRoot, group, timeoutMs, input.lock.path)
      if (toolRun === undefined) continue
      runs.push(toolRun)
      if (toolRun.detachedPid !== undefined) {
        input.lock.transfer(toolRun.detachedPid)
        break
      }
    }
    return { runs, findings: keepOnChangedLines(input.projectRoot, runs.flatMap((toolRun) => toolRun.findings)) }
  },
})
