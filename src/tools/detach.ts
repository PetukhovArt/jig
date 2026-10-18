import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { setPriority } from 'node:os'
import { dirname } from 'node:path'
import { LOW_PRIORITY } from '../core/proc'
import { settleExit, type ToolInvocation, type ToolRun } from './tool'

export interface DetachableInvocation extends ToolInvocation {
  outputPath: string
  lockPath?: string
}

export interface DetachableRun extends ToolRun {
  detachedPid?: number
}

const WRAPPER = [
  "const { spawn } = require('node:child_process')",
  "const { closeSync, openSync, readFileSync, rmSync } = require('node:fs')",
  "const { setPriority } = require('node:os')",
  'const [lockPath, outputPath, priority, command, ...args] = process.argv.slice(1)',
  "const output = openSync(outputPath, 'w')",
  "const child = spawn(command, args, { stdio: ['ignore', output, output], windowsHide: true })",
  'try { setPriority(child.pid, Number(priority)) } catch {}',
  'const releaseOwnLock = () => {',
  "  try { if (JSON.parse(readFileSync(lockPath, 'utf8')).pid === process.pid) rmSync(lockPath, { force: true }) } catch {}",
  '}',
  'const finish = (code) => { closeSync(output); releaseOwnLock(); process.exit(code ?? 1) }',
  "child.on('error', () => finish(1))",
  "child.on('exit', (code) => finish(code))",
].join('\n')

const readOutput = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const lowerPriority = (pid: number | undefined): void => {
  if (pid === undefined) return
  try {
    setPriority(pid, LOW_PRIORITY)
  } catch {
    return
  }
}

export const runDetachable = (invocation: DetachableInvocation): Promise<DetachableRun> => {
  const { tool, argv, cwd, timeoutMs, outputPath, lockPath } = invocation
  mkdirSync(dirname(outputPath), { recursive: true })
  const startedAt = Date.now()
  const elapsed = (): number => Date.now() - startedAt
  return new Promise((resolveRun) => {
    let isSettled = false
    const settle = (result: DetachableRun): void => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      resolveRun(result)
    }
    const child = spawn(process.execPath, ['-e', WRAPPER, lockPath ?? '', outputPath, String(LOW_PRIORITY), ...argv], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    lowerPriority(child.pid)
    const timer = setTimeout(() => {
      child.unref()
      const pid = child.pid
      settle({
        tool,
        findings: [],
        durationMs: elapsed(),
        failure: `timeout after ${timeoutMs} ms, detached (pid ${pid}) to finish the incremental cache`,
        ...(pid === undefined ? {} : { detachedPid: pid }),
      })
    }, timeoutMs)
    child.on('error', (error) => settle({ tool, findings: [], durationMs: elapsed(), failure: error.message }))
    child.on('exit', (code) => {
      const output = readOutput(outputPath)
      settle(settleExit(invocation, { code, output, errorOutput: output, durationMs: elapsed() }))
    })
  })
}
