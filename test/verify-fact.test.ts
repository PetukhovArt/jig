import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { buildPlan, writePlan } from '../src/core/plan'
import { readState } from '../src/core/state'
import { dispatch, type EventBase, type JigEvent, type Outcome } from '../src/hook/dispatch'
import { logToActiveJournal, runTaskStatus } from '../src/task-status/task-status'

const pluginRoot = resolve(__dirname, '..')
const SESSION = 'verify'

let root: string
let base: EventBase

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const send = (event: JigEvent): Promise<Outcome> => dispatch(event, base, pluginRoot)

const edit = async (path: string): Promise<void> => {
  write(path, `export const at = ${Date.now()}\n`)
  await send({ kind: 'post-edit', file: path })
}

const bash = (command: string, ok = true): Promise<Outcome> => send({ kind: 'post-bash', command, ok })

const stopReason = async (): Promise<string | undefined> => {
  const outcome = await send({ kind: 'stop', stopHookActive: false })
  return outcome.type === 'block' ? outcome.reason : undefined
}

const enableAgentView = (): void => {
  const plan = buildPlan(root, pluginRoot)
  plan.tools.agentView = { bin: ['agent-view'], config: join(root, 'agent-view.config.json') }
  writePlan(root, plan)
}

const startRun = (): void => {
  vi.stubEnv('CLAUDE_PROJECT_DIR', root)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  expect(runTaskStatus(['log', 'start', 'Verify'])).toBe(0)
}

const decide = (text: string, why: string): void => {
  expect(logToActiveJournal(root, { phase: 'verify', decision: text, why }, new Date(Date.now() + 1000))).toBe(true)
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'jig-verify-'))
  base = { sessionId: SESSION, projectRoot: root, cwd: root }
  git(['init', '-q'], root)
  write('src/a.ts', 'export const a = 1\n')
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
  await send({ kind: 'session-start', source: 'startup' })
  enableAgentView()
  await send({ kind: 'prompt' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('jig/verify-fact with the agent-view check', () => {
  it('asks a style-only change for a screenshot only', async () => {
    await edit('src/app.css')
    const reason = await stopReason()
    expect(reason).toContain('jig/verify-fact: agent-view has no look proof since files changed (1: src/app.css).')
    expect(reason).not.toContain('behavior')
    await bash('npx agent-view screenshot --out shot.png')
    expect(await stopReason()).toBeUndefined()
  })

  it('asks a component change for act replay and a screenshot', async () => {
    await edit('src/App.vue')
    const reason = await stopReason()
    expect(reason).toContain('agent-view has no behavior and look proof')
    expect(reason).toContain('behavior: run agent-view act replay <use case>, or if not needed:')
    expect(reason).toContain('"skip-verify:behavior" --why "<reason>"')
    expect(reason).toContain('look: run agent-view screenshot, or if not needed:')
    expect(reason).toContain('"skip-verify:look" --why "<reason>"')
    await bash('agent-view act replay open-settings')
    const lookOnly = await stopReason()
    expect(lookOnly).toContain('agent-view has no look proof')
    await bash('agent-view snap')
    expect(await stopReason()).toBeUndefined()
  })

  it('does not count dom, eval, click or fill as proof', async () => {
    await edit('src/App.tsx')
    await bash('agent-view dom --text Save && agent-view eval "1" && agent-view click save && agent-view fill name x')
    expect(await stopReason()).toContain('agent-view has no behavior and look proof')
    expect(readState(root, SESSION)?.checks['agent-view']?.behavior?.proofAt).toBeUndefined()
  })

  it('does not count a failed act replay', async () => {
    await edit('src/App.vue')
    await bash('agent-view act replay open-settings', false)
    await bash('agent-view screenshot')
    expect(await stopReason()).toContain('agent-view has no behavior proof')
  })

  it('ignores test files and non-UI files', async () => {
    await edit('src/App.test.tsx')
    await edit('src/b.ts')
    expect((await stopReason()) ?? '').not.toContain('jig/verify-fact')
  })

  it('lifts every kind with skip-verify and a reason', async () => {
    startRun()
    await edit('src/App.vue')
    decide('skip-verify', 'no dev server in this sandbox')
    expect(await stopReason()).toBeUndefined()
    expect(readJournal(root).filter((record) => record.kind === 'skip-verify').map((record) => record.message)).toEqual([
      'agent-view behavior',
      'agent-view look',
    ])
  })

  it('lifts only the named kind with skip-verify:<kind>', async () => {
    startRun()
    await edit('src/App.vue')
    decide('skip-verify:look', 'only a computed changed')
    const reason = await stopReason()
    expect(reason).toContain('agent-view has no behavior proof')
    expect(reason).not.toContain('skip-verify:look')
    decide('skip-verify:behavior', 'template class tweak')
    expect(await stopReason()).toBeUndefined()
  })

  it('ignores a skip without a reason or with an unknown kind', async () => {
    startRun()
    await edit('src/App.vue')
    decide('skip-verify:look', '  ')
    decide('skip-verify:sound', 'not a kind')
    expect(await stopReason()).toContain('agent-view has no behavior and look proof')
  })

  it('loads a state file written before per-kind proofs', async () => {
    write(
      '.jig/cache/sessions/old.json',
      JSON.stringify({ v: 1, sessionId: 'old', createdAt: '', updatedAt: '', snapshot: {}, edits: [], lastRuntimeEditAt: 1, verifyAt: 2, testChecklistShown: false, delivered: {}, sessionAtoms: [], pendingWarnings: [], stop: { consecutiveBlocks: 0 } }),
    )
    expect(readState(root, 'old')).toMatchObject({ turn: 0, checks: {} })
    base = { ...base, sessionId: 'old' }
    await edit('src/app.css')
    await bash('agent-view screenshot')
    expect(readState(root, 'old')?.checks['agent-view']?.look).toEqual({ editAt: expect.any(Number), proofAt: expect.any(Number) })
  })

  it('stays silent without agent-view in the plan', async () => {
    writePlan(root, buildPlan(root, pluginRoot))
    await edit('src/App.vue')
    expect(await stopReason()).toBeUndefined()
  })
})
