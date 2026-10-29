import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { dispatch, type EventBase, type JigEvent, type Outcome } from '../src/hook/dispatch'

const pluginRoot = resolve(__dirname, '..')

let root: string
let main: string

const sh = (cwd: string, ...args: string[]): void => {
  const result = git(args, cwd)
  if (!result.ok) throw new Error(result.stderr)
}

const writeConfig = (config: unknown): void => {
  mkdirSync(join(main, '.jig'), { recursive: true })
  writeFileSync(join(main, '.jig', 'config.jsonc'), JSON.stringify(config))
}

const base = (cwd: string = main): EventBase => ({ sessionId: 's', projectRoot: main, cwd, attributesShell: true })

const send = (event: JigEvent, cwd?: string): Promise<Outcome> => dispatch(event, base(cwd), pluginRoot)

const shell = async (callId: string, body: () => void): Promise<Outcome> => {
  await send({ kind: 'pre-shell', callId })
  body()
  return send({ kind: 'post-shell', callId, isBackground: false })
}

const addWorktree = (name: string): string => {
  const dir = join(root, name)
  sh(main, 'worktree', 'add', '-q', '--detach', dir, 'main')
  return dir
}

const contextOf = (outcome: Outcome): string => (outcome.type === 'context' ? outcome.text : '')

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-nudge-')))
  main = join(root, 'main')
  sh(root, 'init', '-q', '-b', 'main', main)
  writeFileSync(join(main, '.gitignore'), ['node_modules/', '.jig/', ''].join('\n'))
  writeFileSync(join(main, 'package.json'), '{"name":"app"}')
  writeFileSync(join(main, 'package-lock.json'), '{}')
  sh(main, 'add', '.')
  sh(main, '-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init')
  mkdirSync(join(main, 'node_modules'))
  writeConfig({ worktree: { depsPool: {} } })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('unprovisioned worktree nudge', () => {
  it('names only the worktree a shell command created without dependencies, once, with the seed and deps commands', async () => {
    const old = addWorktree('old')
    let dir = ''
    const first = await shell('a', () => {
      dir = addWorktree('wt')
    })
    const second = await shell('b', () => undefined)

    expect(contextOf(first)).toContain(`worktree ${dir.replace(/\\/g, '/')} has no node_modules of its own`)
    expect(contextOf(first)).toContain('worktree deps')
    expect(contextOf(first)).not.toContain(old.replace(/\\/g, '/'))
    expect(second).toEqual({ type: 'none' })
  })

  it('says nothing without worktree.depsPool in the config', async () => {
    writeConfig({})
    const outcome = await shell('a', () => addWorktree('wt'))

    expect(outcome).toEqual({ type: 'none' })
  })

  it('counts a node_modules linked into the main checkout as unprovisioned', async () => {
    const outcome = await shell('a', () => {
      const dir = addWorktree('wt')
      symlinkSync(join(main, 'node_modules'), join(dir, 'node_modules'), 'junction')
    })

    expect(contextOf(outcome)).toContain('has no node_modules of its own')
  })

  it('names the linked worktree a session starts in, and the one a subagent first edits in, once per agent', async () => {
    const dir = addWorktree('wt')
    const started = await send({ kind: 'session-start', source: 'startup' }, dir)
    const edit: JigEvent = { kind: 'post-edit', file: 'package.json' }
    const subagent = { ...base(dir), agentId: 'sub' }
    const firstEdit = await dispatch(edit, subagent, pluginRoot)
    const secondEdit = await dispatch(edit, subagent, pluginRoot)

    expect(contextOf(started)).toContain('has no node_modules of its own')
    expect(contextOf(firstEdit)).toContain('has no node_modules of its own')
    expect(contextOf(secondEdit)).not.toContain('node_modules')
  })
})
