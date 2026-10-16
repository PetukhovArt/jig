import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { setPriority } from 'node:os'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { gitToplevel } from './git'

export const LOW_PRIORITY = 10
export const LOCK_WAIT_MS = 15_000
export const LOCK_STALE_MS = 5 * 60 * 1000

const LOCK_POLL_MS = 200
const KILL_GRACE_MS = 1_000
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

export interface RunOptions {
  cwd: string
  timeoutMs: number
  input?: string
  env?: NodeJS.ProcessEnv
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
  durationMs: number
}

interface PackageJson {
  bin?: string | Record<string, string>
}

const readPackageJson = (path: string): PackageJson | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

const packageBinName = (pkg: string): string => pkg.split('/').pop() ?? pkg

const isWithin = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

const realPath = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

const searchDirs = (projectRoot: string): string[] => {
  const start = realPath(projectRoot)
  const gitTop = gitToplevel(start)
  const top = gitTop === undefined ? undefined : realPath(gitTop)
  if (top === undefined || !isWithin(top, start)) return [start]
  const dirs = [start]
  let dir = start
  while (relative(top, dir) !== '') {
    const parent = dirname(dir)
    if (parent === dir) break
    dirs.push(parent)
    dir = parent
  }
  return dirs
}

const packageBinIn = (dir: string, pkg: string, binName: string): string[] | undefined => {
  const packageDir = join(dir, 'node_modules', ...pkg.split('/'))
  const manifest = readPackageJson(join(packageDir, 'package.json'))
  const bin = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.[binName]
  if (bin === undefined) return undefined
  const script = resolve(packageDir, bin)
  return existsSync(script) ? [process.execPath, script] : undefined
}

export const resolvePackageBin = (projectRoot: string, pkg: string, binName: string = packageBinName(pkg)): string[] | undefined => {
  for (const dir of searchDirs(projectRoot)) {
    const bin = packageBinIn(dir, pkg, binName)
    if (bin !== undefined) return bin
  }
  return undefined
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export const findInPath = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const isWindows = process.platform === 'win32'
  const pathValue = env['PATH'] ?? env['Path'] ?? ''
  const extensions = isWindows && extname(name) === ''
    ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, name + extension.toLowerCase())
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

const SHIM_EXTENSIONS = new Set(['.cmd', '.bat'])
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const SHIM_TARGET = /"%(?:~dp0|dp0%)\\([^"%]+)"/gi
const NODE_EXECUTABLE = /^node(?:\.exe)?$/i

const isShim = (path: string): boolean => SHIM_EXTENSIONS.has(extname(path).toLowerCase())

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export const resolveShimTarget = (shimPath: string): string[] | undefined => {
  const text = readText(shimPath) ?? ''
  const targets = [...text.matchAll(SHIM_TARGET)]
    .map((match) => (match[1] ?? '').replace(/\\/g, '/'))
    .filter((target) => !NODE_EXECUTABLE.test(basename(target)))
  const target = targets.at(-1)
  if (target === undefined) return undefined
  const absolute = resolve(dirname(shimPath), target)
  if (!isFile(absolute)) return undefined
  const extension = extname(absolute).toLowerCase()
  if (SCRIPT_EXTENSIONS.has(extension)) return [process.execPath, absolute]
  return extension === '.exe' ? [absolute] : undefined
}

export const resolveBin = (projectRoot: string, pkgs: readonly string[], command: string): string[] | undefined => {
  for (const pkg of pkgs) {
    const bin = resolvePackageBin(projectRoot, pkg, command)
    if (bin !== undefined) return bin
  }
  const found = findInPath(command)
  if (found === undefined) return undefined
  return isShim(found) ? resolveShimTarget(found) : [found]
}

export const findUnresolvedShim = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const found = findInPath(name, env)
  const isUnresolved = found !== undefined && isShim(found) && resolveShimTarget(found) === undefined
  return isUnresolved ? found : undefined
}

const lowerPriority = (pid: number | undefined): void => {
  if (pid === undefined) return
  try {
    setPriority(pid, LOW_PRIORITY)
  } catch {
    return
  }
}

export const run = (argv: readonly string[], options: RunOptions): Promise<RunResult> => {
  const [command, ...args] = argv
  const startedAt = Date.now()
  if (command === undefined) {
    return Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: false, error: 'empty argv', durationMs: 0 })
  }
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    lowerPriority(child.pid)
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let timedOut = false
    let spawnError: string | undefined
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        target.push(chunk)
      }
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref()
    }, options.timeoutMs)
    child.on('error', (error) => {
      spawnError = error.message
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const result: RunResult = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        durationMs: Date.now() - startedAt,
      }
      resolveRun(spawnError === undefined ? result : { ...result, error: spawnError })
    })
  })
}

export interface LockInfo {
  pid: number
  at: number
}

export interface Lock {
  path: string
  release: () => void
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const readLock = (path: string): LockInfo | undefined => {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockInfo>
    const isValid = typeof value.pid === 'number' && typeof value.at === 'number'
    return isValid ? { pid: value.pid as number, at: value.at as number } : undefined
  } catch {
    return undefined
  }
}

const lockFileAge = (path: string, now: number): number | undefined => {
  try {
    return now - statSync(path).mtimeMs
  } catch {
    return undefined
  }
}

export const isLockAbandoned = (path: string, now: number = Date.now()): boolean => {
  const info = readLock(path)
  if (info !== undefined) return now - info.at > LOCK_STALE_MS || !isAlive(info.pid)
  const age = lockFileAge(path, now)
  return age !== undefined && age > LOCK_STALE_MS
}

const tryCreateLock = (path: string): boolean => {
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

export const acquireLock = async (path: string, waitMs: number = LOCK_WAIT_MS): Promise<Lock | undefined> => {
  mkdirSync(dirname(path), { recursive: true })
  const deadline = Date.now() + waitMs
  for (;;) {
    if (tryCreateLock(path)) {
      return { path, release: () => rmSync(path, { force: true }) }
    }
    if (isLockAbandoned(path)) {
      rmSync(path, { force: true })
      continue
    }
    if (Date.now() >= deadline) return undefined
    await sleep(LOCK_POLL_MS)
  }
}
