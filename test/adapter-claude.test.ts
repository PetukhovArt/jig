import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatOutcome, parseHookInput } from '../src/adapters/claude'
import { toSlash } from '../src/core/paths'
import { handleHook, type JigEvent, type Outcome } from '../src/hook/dispatch'
import { checkComments } from '../src/rules/comments'
import { checkNoVerify } from '../src/rules/no-verify'
import { checkProtectedPath, checkShellWrite } from '../src/rules/protected'
import { checkSuppressions } from '../src/rules/suppressions'

vi.mock('../src/rules/protected', () => ({ checkProtectedPath: vi.fn(), checkShellWrite: vi.fn() }))
vi.mock('../src/rules/suppressions', () => ({ checkSuppressions: vi.fn(() => []) }))
vi.mock('../src/rules/comments', () => ({ checkComments: vi.fn(() => []) }))
vi.mock('../src/rules/no-verify', () => ({ checkNoVerify: vi.fn() }))

interface HookFixture {
  name: string
  files?: Record<string, string>
  input: Record<string, unknown>
  expected: { base: { sessionId: string; agentId?: string }; event: JigEvent }
}

const FIXTURES_DIR = join(__dirname, 'fixtures', 'hooks')
const PLUGIN_ROOT = resolve(tmpdir(), 'jig-plugin-root')

let project: string

const substitute = (value: unknown): unknown => {
  if (typeof value === 'string') return value.replaceAll('${PROJECT}', toSlash(project))
  if (Array.isArray(value)) return value.map(substitute)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry)]))
  }
  return value
}

const env = (): NodeJS.ProcessEnv => ({ CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT })

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'jig-adapter-'))
})

afterAll(() => {
  rmSync(project, { recursive: true, force: true })
})

describe('stdin JSON to JigEvent', () => {
  const names = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'))

  it.each(names)('%s', (name) => {
    const fixture = substitute(JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'))) as HookFixture
    for (const [file, content] of Object.entries(fixture.files ?? {})) {
      mkdirSync(dirname(join(project, file)), { recursive: true })
      writeFileSync(join(project, file), content)
    }

    const parsed = parseHookInput(fixture.name, JSON.stringify(fixture.input), env())

    expect(parsed?.event).toEqual(fixture.expected.event)
    expect(parsed?.base).toEqual({
      ...fixture.expected.base,
      projectRoot: resolve(project),
      cwd: resolve(String(fixture.input['cwd'])),
    })
  })
})

describe('Outcome to stdout JSON', () => {
  const cases: [JigEvent['kind'], Outcome, string][] = [
    ['post-edit', { type: 'none' }, ''],
    ['pre-edit', { type: 'none' }, ''],
    [
      'pre-edit',
      { type: 'deny', reason: 'no' },
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}',
    ],
    [
      'pre-bash',
      { type: 'deny', reason: 'no' },
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}',
    ],
    ['post-edit', { type: 'context', text: 'a\nb' }, '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"a\\nb"}}'],
    ['post-read', { type: 'context', text: 't' }, '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"t"}}'],
    ['session-start', { type: 'context', text: 't' }, '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"t"}}'],
    ['subagent-start', { type: 'context', text: 't' }, '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"t"}}'],
    ['stop', { type: 'block', reason: 'fix types' }, '{"decision":"block","reason":"fix types"}'],
  ]

  it.each(cases)('%s %j', (kind, outcome, expected) => {
    expect(formatOutcome(kind, outcome)).toBe(expected)
  })
})

describe('hook input that cannot be read', () => {
  const inputs = ['', 'not json', '[]', 'null', '{"session_id":1}', '{"session_id":"s1","cwd":"."}']

  it.each(inputs)('%j gives an empty answer for every hook name', async (raw) => {
    for (const name of ['pre-edit', 'pre-bash', 'post-edit', 'session-start', 'unknown']) {
      await expect(handleHook(name, raw, env())).resolves.toBe('')
    }
  })
})

describe('guards fail closed', () => {
  const guardText = (message: string): string =>
    `jig: guard failed (${message}); the action is blocked. Run "node ${toSlash(PLUGIN_ROOT)}/bin/jig.mjs doctor" and report it`

  const denial = (reason: string): string =>
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })

  const editInput = (): string =>
    JSON.stringify({
      session_id: 's-guard',
      cwd: project,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(project, 'src', 'a.ts'), old_string: 'a', new_string: 'b' },
    })

  const bashInput = (command: string): string =>
    JSON.stringify({ session_id: 's-guard', cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })

  beforeEach(() => {
    vi.mocked(checkProtectedPath).mockReset()
    vi.mocked(checkShellWrite).mockReset()
    vi.mocked(checkNoVerify).mockReset()
    vi.mocked(checkComments).mockReset().mockReturnValue([])
    vi.mocked(checkSuppressions).mockReset().mockReturnValue([])
  })

  it('denies the edit when the protected-paths check throws', async () => {
    vi.mocked(checkProtectedPath).mockImplementation(() => {
      throw new Error('glob exploded')
    })

    await expect(handleHook('pre-edit', editInput(), env())).resolves.toBe(denial(guardText('glob exploded')))
  })

  it('denies the command when the no-verify check throws', async () => {
    vi.mocked(checkNoVerify).mockImplementation(() => {
      throw new Error('git missing')
    })

    await expect(handleHook('pre-bash', bashInput('git commit --no-verify'), env())).resolves.toBe(
      denial(guardText('git missing')),
    )
  })

  it('lets the edit through when the comments check throws', async () => {
    vi.mocked(checkComments).mockImplementation(() => {
      throw new Error('lexer bug')
    })

    await expect(handleHook('pre-edit', editInput(), env())).resolves.toBe('')
  })

  it('lets the command through when the shell-write check throws', async () => {
    vi.mocked(checkShellWrite).mockImplementation(() => {
      throw new Error('tokenizer bug')
    })

    await expect(handleHook('pre-bash', bashInput('echo hi > out.txt'), env())).resolves.toBe('')
  })

  it('passes the file line where the edited text starts to the open checks', async () => {
    const file = join(project, 'src', 'a.ts')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'x\nx\nx\nconst marker = 1\n')
    const input = JSON.stringify({
      session_id: 's-guard',
      cwd: project,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: 'const marker = 1', new_string: 'const marker = 2' },
    })

    await handleHook('pre-edit', input, env())

    expect(vi.mocked(checkComments).mock.calls[0]?.[1]).toEqual([{ before: 'const marker = 1', after: 'const marker = 2', line: 4 }])
    expect(vi.mocked(checkSuppressions).mock.calls[0]?.[1]?.[0]?.line).toBe(4)
  })

  it('denies with the rule text when a guard finds an error', async () => {
    const message = 'jig/protected-paths: tsconfig.json configures the checks and is protected.'
    vi.mocked(checkProtectedPath).mockReturnValue({
      tool: 'jig',
      rule: 'jig/protected-paths',
      severity: 'error',
      file: 'tsconfig.json',
      line: 1,
      message,
    })

    await expect(handleHook('pre-edit', editInput(), env())).resolves.toBe(denial(message))
  })
})
