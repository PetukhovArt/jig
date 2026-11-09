import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claude, codex } from '../src/adapters/claude'
import { git } from '../src/core/git'
import { handleHook } from '../src/hook/dispatch'

let root: string
let main: string
let worktree: string

const sh = (cwd: string, ...args: string[]): void => {
  const result = git(args, cwd)
  if (!result.ok) throw new Error(result.stderr)
}

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const env = { CLAUDE_PLUGIN_ROOT: resolve(__dirname, '..'), JIG_PROJECT_DIR: '' }

const hook = async (name: string, input: Record<string, unknown>, adapter = claude): Promise<Record<string, unknown>> => {
  const output = await handleHook(name, JSON.stringify({ session_id: 's', cwd: main, ...input }), { ...env, CLAUDE_PROJECT_DIR: main }, adapter)
  return output === '' ? {} : (JSON.parse(output) as Record<string, unknown>)
}

const contextOf = (output: Record<string, unknown>): string => {
  const specific = output['hookSpecificOutput'] as Record<string, unknown> | undefined
  return String(specific?.['additionalContext'] ?? specific?.['permissionDecisionReason'] ?? '')
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-rules-')))
  main = join(root, 'repo')
  write(join(main, 'CLAUDE.md'), 'root rules\n')
  write(join(main, 'src/a/CLAUDE.md'), '@AGENTS.md\n')
  write(join(main, 'src/a/AGENTS.md'), 'MID-RULE\n')
  write(join(main, 'src/a/GLOSSARY.md'), '**enabled**\n_Avoid_: disabled\n')
  write(join(main, 'src/a/b/AGENTS.md'), 'LEAF-RULE\n')
  write(join(main, 'src/a/b/tab.ts'), 'export interface Tab {}\n')
  write(join(main, '.gitignore'), '.jig/\n')
  sh(root, 'init', '-q', '-b', 'main', main)
  sh(main, 'add', '.')
  sh(main, '-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init')
  worktree = join(root, 'repo-worktrees', 'task')
  sh(main, 'worktree', 'add', '-q', '-b', 'task', worktree)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('rule files for a touched path', () => {
  it('gives a file in a sibling worktree its whole chain once, with the glossary path, and skips what the harness loaded at start', async () => {
    await hook('session-start', { source: 'startup' })
    const file = join(worktree, 'src/a/b/tab.ts')
    const first = contextOf(await hook('post-shell', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: `cat "${file}"` } }))
    expect(first).toContain('MID-RULE')
    expect(first).toContain('LEAF-RULE')
    expect(first).toContain('root rules')
    expect(first).toContain('GLOSSARY.md')
    const again = await hook('touch', { tool_name: 'Read', tool_input: { file_path: file } })
    expect(again).toEqual({})
    const mainFile = join(main, 'src/a/b/tab.ts')
    const inMain = contextOf(await hook('touch', { tool_name: 'Grep', tool_input: { path: mainFile } }))
    expect(inMain).toContain('LEAF-RULE')
    expect(inMain).not.toContain('root rules')
  })

  it('denies the first edit of a file whose rules were never given and lets the repeat through', async () => {
    await hook('session-start', { source: 'startup' })
    const file = join(worktree, 'src/a/b/tab.ts')
    const patch = `*** Begin Patch\n*** Update File: ${file}\n@@\n-export interface Tab {}\n+export interface Tab { enabled: boolean }\n*** End Patch`
    const denied = await hook('pre-edit', { tool_name: 'apply_patch', tool_input: { command: patch } }, codex)
    expect(JSON.stringify(denied)).toContain('"permissionDecision":"deny"')
    expect(contextOf(denied)).toContain('LEAF-RULE')
    expect(await hook('pre-edit', { tool_name: 'apply_patch', tool_input: { command: patch } }, codex)).toEqual({})
  })

  it('gives the rules again after compaction', async () => {
    await hook('session-start', { source: 'startup' })
    const file = join(worktree, 'src/a/b/tab.ts')
    await hook('touch', { tool_name: 'Read', tool_input: { file_path: file } })
    await hook('session-start', { source: 'compact' })
    expect(contextOf(await hook('touch', { tool_name: 'Read', tool_input: { file_path: file } }))).toContain('LEAF-RULE')
  })
})
