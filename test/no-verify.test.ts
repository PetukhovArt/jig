import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../src/core/config'
import { git } from '../src/core/git'
import { createSessionState, readState, writeState } from '../src/core/state'
import { checkNoVerify, runAllowNoVerify } from '../src/rules/no-verify'

const SESSION = 'no-verify-test'
const COMMIT = 'git commit --no-verify -m x'

let root: string
const savedEnv = { ...process.env }

const write = (path: string, text: string, mode?: number): void => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text, mode === undefined ? {} : { mode })
}

const installFailingHook = (failingPath: string): void => {
  write('.git/hooks/pre-commit', `#!/bin/sh\necho "${failingPath}:3:1 error no-unused-vars" >&2\nexit 1\n`, 0o755)
}

const check = () => checkNoVerify(COMMIT, { projectRoot: root, sessionId: SESSION, config: defaultConfig() })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-no-verify-'))
  process.env['CLAUDE_PROJECT_DIR'] = root
  process.env['CLAUDE_CODE_SESSION_ID'] = SESSION
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  git(['init', '-q'], root)
  write('src/outside.js', 'export const a = 1\n')
  write('src/staged.js', 'export const b = 1\n')
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
  write('src/staged.js', 'export const b = 2\n')
  git(['add', 'src/staged.js'], root)
  writeState(root, createSessionState(SESSION, {}))
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...savedEnv }
  rmSync(root, { recursive: true, force: true })
})

describe('allow-no-verify', () => {
  it('allows one commit when the hook fails only outside the staged files', () => {
    installFailingHook('src/outside.js')
    expect(runAllowNoVerify([])).toBe(0)
    expect(readState(root, SESSION)?.noVerifyAllowance?.used).toBe(false)
    expect(check()).toBeUndefined()
    expect(check()?.rule).toBe('jig/no-verify')
  })

  it('refuses when the hook fails on a staged file', () => {
    installFailingHook('src/staged.js')
    expect(runAllowNoVerify([])).toBe(1)
    expect(readState(root, SESSION)?.noVerifyAllowance).toBeUndefined()
    expect(check()?.rule).toBe('jig/no-verify')
  })

  it('drops the allowance when the staged set changes', () => {
    installFailingHook('src/outside.js')
    expect(runAllowNoVerify([])).toBe(0)
    write('src/extra.js', 'export const c = 1\n')
    git(['add', 'src/extra.js'], root)
    expect(check()?.rule).toBe('jig/no-verify')
  })
})
