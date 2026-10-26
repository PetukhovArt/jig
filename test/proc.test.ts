import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { findUnresolvedShim, resolveBin, resolvePackageBin, resolveShimTarget, run } from '../src/core/proc'

let workDir: string

const write = (path: string, text: string): string => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  return path
}

const addPackage = (dir: string, pkg: string, bin: string): string => {
  const packageDir = join(dir, 'node_modules', pkg)
  write(join(packageDir, 'package.json'), JSON.stringify({ name: pkg, bin: { [pkg]: bin } }))
  return write(join(packageDir, bin), '')
}

const npmShim = (target: string): string =>
  [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
  ].join('\r\n')

beforeAll(() => {
  workDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-proc-')))
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('resolvePackageBin', () => {
  let repo: string
  let app: string

  beforeAll(() => {
    repo = join(workDir, 'outer', 'repo')
    app = join(repo, 'packages', 'app')
    mkdirSync(app, { recursive: true })
    git(['init', '-q'], repo)
    addPackage(join(workDir, 'outer'), 'outside', 'bin/cli.js')
    addPackage(repo, 'hoisted', 'bin/cli.js')
    addPackage(repo, 'near', 'bin/far.js')
    addPackage(app, 'near', 'bin/near.js')
  })

  it('finds a package hoisted above the project root inside the git root', () => {
    expect(resolvePackageBin(app, 'hoisted')).toEqual([process.execPath, join(repo, 'node_modules', 'hoisted', 'bin', 'cli.js')])
  })

  it('prefers the nearest package', () => {
    expect(resolvePackageBin(app, 'near')?.[1]).toBe(join(app, 'node_modules', 'near', 'bin', 'near.js'))
  })

  it('does not climb above the git root', () => {
    expect(resolvePackageBin(app, 'outside')).toBeUndefined()
  })

  it('looks only in the project root outside git', () => {
    const plain = join(workDir, 'plain', 'project')
    mkdirSync(plain, { recursive: true })
    addPackage(join(workDir, 'plain'), 'parent', 'bin/cli.js')
    expect(resolvePackageBin(plain, 'parent')).toBeUndefined()
  })
})

describe('a command installed in the project', () => {
  it('resolves from node_modules/.bin before PATH', () => {
    const project = join(workDir, 'local-bin')
    const script = write(join(project, 'node_modules', 'checker', 'bin', 'check.js'), '')
    const unixBin = write(join(project, 'node_modules', '.bin', 'checker'), '')
    write(join(project, 'node_modules', '.bin', 'checker.cmd'), npmShim('..\\checker\\bin\\check.js'))
    const expected = process.platform === 'win32' ? [process.execPath, script] : [unixBin]
    expect(resolveBin(project, [], 'checker')).toEqual(expected)
  })
})

describe('npm shims in PATH', () => {
  let shims: string
  let jsTarget: string
  let exeTarget: string
  let npmCliTarget: string

  beforeAll(() => {
    shims = join(workDir, 'shims')
    jsTarget = write(join(shims, 'node_modules', 'js-tool', 'bin', 'cli.js'), '')
    exeTarget = write(join(shims, 'tools', 'native.exe'), '')
    write(join(shims, 'js-tool.cmd'), npmShim('node_modules\\js-tool\\bin\\cli.js'))
    write(join(shims, 'exe-tool.cmd'), '@"%~dp0\\tools\\native.exe" %*\r\n')
    write(join(shims, 'junk-tool.bat'), '@echo hello\r\n')
    write(join(shims, 'gone-tool.cmd'), npmShim('node_modules\\gone\\cli.js'))
    npmCliTarget = write(join(shims, 'node_modules', 'npm', 'bin', 'npx-cli.js'), '')
    write(join(shims, 'node_modules', 'npm', 'bin', 'npm-prefix.js'), '')
    write(
      join(shims, 'npx.cmd'),
      [
        '@ECHO OFF',
        'SET "NODE_EXE=%~dp0\\node.exe"',
        'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
        'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"',
        `FOR /F "delims=" %%F IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO (`,
        '  SET "NPM_PREFIX_NPX_CLI_JS=%%F\\node_modules\\npm\\bin\\npx-cli.js"',
        ')',
        '"%NODE_EXE%" "%NPX_CLI_JS%" %*',
        '',
      ].join('\r\n'),
    )
  })

  it.each([
    ['a js target runs through node', 'js-tool.cmd', () => [process.execPath, jsTarget]],
    ["node's own npx.cmd runs its cli through node", 'npx.cmd', () => [process.execPath, npmCliTarget]],
    ['an exe target runs directly', 'exe-tool.cmd', () => [exeTarget]],
    ['an unrecognized shim is not found', 'junk-tool.bat', () => undefined],
    ['a missing target is not found', 'gone-tool.cmd', () => undefined],
  ])('%s', (_name, shim, expected) => {
    expect(resolveShimTarget(join(shims, shim))).toEqual(expected())
  })

  it('resolveBin goes through the shim', () => {
    const savedPath = process.env['PATH']
    process.env['PATH'] = shims
    try {
      expect(resolveBin(workDir, [], 'js-tool.cmd')).toEqual([process.execPath, jsTarget])
      expect(resolveBin(workDir, [], 'junk-tool.bat')).toBeUndefined()
    } finally {
      process.env['PATH'] = savedPath
    }
  })

  it('findUnresolvedShim reports only shims without a recognized target', () => {
    const env = { PATH: shims }
    expect(findUnresolvedShim('junk-tool.bat', env)).toBe(join(shims, 'junk-tool.bat'))
    expect(findUnresolvedShim('js-tool.cmd', env)).toBeUndefined()
    expect(findUnresolvedShim('absent-tool.cmd', env)).toBeUndefined()
  })
})

describe('a command given as a path', () => {
  it.each([
    ['an absolute binary runs directly', () => join(workDir, 'shims', 'tools', 'native.exe'), () => [join(workDir, 'shims', 'tools', 'native.exe')]],
    ['a relative script runs through node', () => 'shims/node_modules/js-tool/bin/cli.js', () => [process.execPath, join(workDir, 'shims', 'node_modules', 'js-tool', 'bin', 'cli.js')]],
    ['a shim resolves to its target', () => join(workDir, 'shims', 'exe-tool.cmd'), () => [join(workDir, 'shims', 'tools', 'native.exe')]],
    ['a missing file is not found', () => join(workDir, 'absent', 'tool.exe'), () => undefined],
  ])('%s', (_name, command, expected) => {
    expect(resolveBin(workDir, [], command())).toEqual(expected())
  })
})

describe('a command that times out', () => {
  const isAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
    } catch {
      return false
    }
    try {
      return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z'
    } catch {
      return true
    }
  }

  const outlives = async (pid: number, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms
    while (isAlive(pid)) {
      if (Date.now() > deadline) return true
      await new Promise((done) => setTimeout(done, 100))
    }
    return false
  }

  it('ends with its grandchildren, which hold its output pipes', async () => {
    const pidFile = join(workDir, 'grandchild.pid')
    const parent = write(
      join(workDir, 'tree', 'parent.cjs'),
      [
        "const { spawn } = require('node:child_process')",
        "const detached = process.platform === 'win32'",
        "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit', detached })",
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
        'setTimeout(() => {}, 60000)',
      ].join('\n'),
    )
    const startedAt = Date.now()
    const result = await run([process.execPath, parent], { cwd: workDir, timeoutMs: 1_000 })
    expect(result.timedOut).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(10_000)
    expect(await outlives(Number(readFileSync(pidFile, 'utf8')), 5_000)).toBe(false)
  }, 70_000)
})
