import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatOutcome, parseHookInput } from '../src/adapters/claude'
import { toSlash } from '../src/core/paths'
import { handleHook, type JigEvent, type Outcome } from '../src/hook/dispatch'
import { checkComments } from '../src/rules/comments'
import { checkSuppressions } from '../src/rules/suppressions'

vi.mock('../src/rules/suppressions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/rules/suppressions')>()),
  checkSuppressions: vi.fn(() => []),
}))
vi.mock('../src/rules/comments', () => ({ checkComments: vi.fn(() => []) }))

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
    ['post-edit', { type: 'context', text: 'a\nb' }, '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"a\\nb"}}'],
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
    for (const name of ['pre-edit', 'post-edit', 'session-start', 'unknown']) {
      await expect(handleHook(name, raw, env())).resolves.toBe('')
    }
  })
})

describe('guards fail closed', () => {
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

  beforeEach(() => {
    vi.mocked(checkComments).mockReset().mockReturnValue([])
    vi.mocked(checkSuppressions).mockReset().mockReturnValue([])
  })

  it('lets the edit through when the comments check throws', async () => {
    vi.mocked(checkComments).mockImplementation(() => {
      throw new Error('lexer bug')
    })

    await expect(handleHook('pre-edit', editInput(), env())).resolves.toBe('')
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

    expect(vi.mocked(checkComments).mock.calls[0]?.[1]).toEqual([
      { before: 'const marker = 1', after: 'const marker = 2', line: 4, prefix: 'x\nx\nx\n' },
    ])
    expect(vi.mocked(checkSuppressions).mock.calls[0]?.[1]?.[0]?.line).toBe(4)
  })

  it('allows JSDoc on a member of an exported interface when the edit omits the declaration line', async () => {
    const actual = await vi.importActual<typeof import('../src/rules/comments')>('../src/rules/comments')
    vi.mocked(checkComments).mockReset().mockImplementation(actual.checkComments)
    const file = join(project, 'src', 'options.ts')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'export interface Options {\n  size: number\n}\n')
    const input = JSON.stringify({
      session_id: 's-guard',
      cwd: project,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: '  size: number', new_string: '  /** Width in pixels. */\n  width: number' },
    })

    await expect(handleHook('pre-edit', input, env())).resolves.toBe('')
  })

  it('denies with the rule text when a guard finds an error', async () => {
    const message = 'jig/suppressions: a directive at src/a.ts:1 silences a check.'
    vi.mocked(checkSuppressions).mockReturnValue([
      { tool: 'jig', rule: 'jig/suppressions', severity: 'error', file: 'src/a.ts', line: 1, message },
    ])

    await expect(handleHook('pre-edit', editInput(), env())).resolves.toBe(denial(message))
  })
})
