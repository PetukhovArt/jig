import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { git } from '../src/core/git'
import { toSlash } from '../src/core/paths'
import { findDuplicates, lowestFreeSlot, runSlot, setEnvValue, slotNumber, slotWorktrees } from '../src/slot/slot'

const REPO = 'app'

const worktreesAt = (...names: string[]) =>
  slotWorktrees(names.map((name) => ({ path: join(tmpdir(), name), isPrunable: false })), REPO)

describe('slot number', () => {
  it.each([
    ['app-s1', 1],
    ['app-s1-feature', 1],
    ['app-s10', 10],
    ['app-s10-feature', 10],
    ['app-s1x', undefined],
    ['app-s0', undefined],
    ['other-s1', undefined],
    ['app', undefined],
  ])('%s → %s', (name, expected) => {
    expect(slotNumber(name, REPO)).toBe(expected)
  })

  it('does not take s10 for s1', () => {
    expect(lowestFreeSlot(worktreesAt('app-s10-x'))).toBe(1)
    expect(lowestFreeSlot(worktreesAt('app-s1-a', 'app-s10-x', 'app-s2'))).toBe(3)
  })

  it('reports duplicate numbers only', () => {
    const duplicates = findDuplicates(worktreesAt('app-s5-a', 'app-s5-b', 'app-s50', 'app-s1'))
    expect([...duplicates.keys()]).toEqual([5])
    expect(duplicates.get(5)).toHaveLength(2)
  })
})

describe('env key', () => {
  it.each([
    ['A=1\nPORT=3000\nB=2\n', 'A=1\nPORT=3010\nB=2\n'],
    ['export PORT = 3000\r\n', 'export PORT=3010\r\n'],
    ['A=1', 'A=1\nPORT=3010\n'],
    ['APP_PORT=1\n', 'APP_PORT=1\nPORT=3010\n'],
    ['', 'PORT=3010\n'],
  ])('%j → %j', (before, after) => {
    expect(setEnvValue(before, 'PORT', '3010')).toBe(after)
  })
})

describe('slot commands in a temporary repository', () => {
  let root: string
  let main: string
  let output: string[] = []
  const previousProjectDir = process.env['CLAUDE_PROJECT_DIR']

  const sh = (cwd: string, ...args: string[]): string => {
    const result = git(args, cwd)
    if (!result.ok) throw new Error(result.stderr)
    return result.stdout
  }

  const runIn = async (args: string[]): Promise<{ code: number; stdout: string }> => {
    output = []
    const code = await runSlot(args)
    return { code, stdout: output.join('') }
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'jig-slot-'))
    main = join(root, REPO)
    mkdirSync(join(main, '.jig'), { recursive: true })
    sh(root, 'init', '-q', '-b', 'main', main)
    sh(main, 'config', 'user.email', 'test@example.com')
    sh(main, 'config', 'user.name', 'test')
    writeFileSync(join(main, '.gitignore'), '.env*\nnode_modules/\n.jig/cache/\n')
    writeFileSync(
      join(main, '.jig', 'config.jsonc'),
      JSON.stringify({
        slots: {
          worktreesDir: '../worktrees',
          dev: 'npm run dev',
          runtime: 'electron',
          ports: { VITE_SERVER_PORT: { base: 3000, step: 10 } },
          cdp: { base: 9900, step: 1 },
          copyFiles: ['env/.env.local'],
        },
      }),
    )
    writeFileSync(join(main, 'agent-view.config.json'), JSON.stringify({ runtime: 'browser', port: 9900, launch: 'npm start' }))
    sh(main, 'add', '.')
    sh(main, 'commit', '-q', '-m', 'init')
    writeFileSync(join(main, '.env'), 'API=https://example.test\nVITE_SERVER_PORT=3000\n')
    writeFileSync(join(main, '.env.local'), 'LOCAL=1\n')
    mkdirSync(join(main, 'env'))
    writeFileSync(join(main, 'env', '.env.local'), 'NESTED=1\n')
    process.env['CLAUDE_PROJECT_DIR'] = main
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterAll(() => {
    vi.restoreAllMocks()
    if (previousProjectDir === undefined) {
      delete process.env['CLAUDE_PROJECT_DIR']
    } else {
      process.env['CLAUDE_PROJECT_DIR'] = previousProjectDir
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('creates slots with offset ports, env files and agent-view config', async () => {
    const first = await runIn(['new', '--slug', 'one', '--branch', 'feat/one'])
    const second = await runIn(['new'])
    const dir = join(root, 'worktrees', `${REPO}-s2`)

    expect(first.code).toBe(0)
    expect(first.stdout).toBe(`slot 1 ${toSlash(join(root, 'worktrees', `${REPO}-s1-one`))} ports VITE_SERVER_PORT=3010 cdp 9901\n`)
    expect(second.code).toBe(0)
    expect(second.stdout).toBe(`slot 2 ${toSlash(dir)} ports VITE_SERVER_PORT=3020 cdp 9902\n`)
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('API=https://example.test\nVITE_SERVER_PORT=3020\n')
    expect(readFileSync(join(dir, '.env.local'), 'utf8')).toBe('LOCAL=1\n')
    expect(readFileSync(join(dir, 'env', '.env.local'), 'utf8')).toBe('NESTED=1\n')
    expect(JSON.parse(readFileSync(join(dir, 'agent-view.config.json'), 'utf8'))).toEqual({
      runtime: 'electron',
      port: 9902,
      launch: 'npm start',
    })
    expect(sh(dir, 'status', '--porcelain', '--untracked-files=no')).toBe('')
    expect(readFileSync(join(main, '.env'), 'utf8')).toBe('API=https://example.test\nVITE_SERVER_PORT=3000\n')
  })

  it('lists slots and reuses the lowest free number after rm', async () => {
    const listed = await runIn(['ls', '--json'])
    expect(JSON.parse(listed.stdout)).toMatchObject([
      { slot: 1, branch: 'feat/one', ports: { VITE_SERVER_PORT: 3010 }, cdp: 9901 },
      { slot: 2, branch: null, ports: { VITE_SERVER_PORT: 3020 }, cdp: 9902 },
    ])
    expect(sh(main, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean).sort()).toEqual(['feat/one', 'main'])

    expect((await runIn(['rm', '1'])).code).toBe(0)
    const next = await runIn(['new', '--slug', 'again'])
    expect(next.stdout).toMatch(/^slot 1 .*app-s1-again ports VITE_SERVER_PORT=3010 cdp 9901\n$/)
  })

  it('refuses rm on tracked changes without --force', async () => {
    const dir = join(root, 'worktrees', `${REPO}-s2`)
    writeFileSync(join(dir, '.gitignore'), 'changed\n')

    expect((await runIn(['rm', '2'])).code).toBe(1)
    expect((await runIn(['rm', '2', '--force'])).code).toBe(0)
  })

  it('sweeps every worktree but main and ignores skip-worktree files of a slot', async () => {
    const plain = join(root, 'worktrees', 'plain')
    sh(main, 'worktree', 'add', '-q', plain, '-b', 'plain')
    writeFileSync(join(plain, 'agent-view.config.json'), '{}\n')
    const slotDir = toSlash(join(root, 'worktrees', `${REPO}-s1-again`))

    const swept = await runIn(['sweep', '--json'])
    const text = await runIn(['sweep'])

    expect(JSON.parse(swept.stdout)).toEqual([
      { bucket: 'recent', slot: 1, path: slotDir, branch: null },
      { bucket: 'hold-wip', slot: null, path: toSlash(plain), branch: 'plain' },
    ])
    expect(text.stdout).toBe(`recent  ${slotDir}  (detached)  slot 1\nhold-wip  ${toSlash(plain)}  plain\n`)
  })

  it('refuses new when two worktrees share a slot number', async () => {
    sh(main, 'worktree', 'add', '-q', join(root, 'worktrees', `${REPO}-s7-a`), '-b', 'dup-a')
    sh(main, 'worktree', 'add', '-q', join(root, 'worktrees', `${REPO}-s7-b`), '-b', 'dup-b')

    expect((await runIn(['new'])).code).toBe(1)
  })
})
