import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { formatOutcome, parseHookInput } from '../src/adapters/claude'
import { git } from '../src/core/git'
import { readJournal } from '../src/core/journal'
import { toSlash } from '../src/core/paths'
import { handleHook, type JigEvent, type Outcome } from '../src/hook/dispatch'
import { declaredReference } from '../src/ui/dir'

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

describe('pre-edit and subagent-start through the adapter', () => {
  const TS_IGNORE = '@ts-' + 'ignore'

  const editInput = (sessionId: string, file: string, before: string, after: string): string =>
    JSON.stringify({
      session_id: sessionId,
      cwd: project,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: before, new_string: after },
    })

  const reasonOf = (output: string): string | undefined =>
    output === '' ? undefined : (JSON.parse(output) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason

  it('denies a suppression at the file line where the edited text starts', async () => {
    const file = join(project, 'src', 'marker.ts')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'x\nx\nx\nconst marker = 1\n')

    const output = await handleHook('pre-edit', editInput('s-line', file, 'const marker = 1', `// ${TS_IGNORE}\nconst marker = 1`), env())

    expect(reasonOf(output)).toContain(`"${TS_IGNORE}" at src/marker.ts:4 silences a check`)
  })

  it('denies the first new test case and lets the same call pass', async () => {
    const file = join(project, 'src', 'sum.test.ts')
    writeFileSync(file, "it('adds', () => {})\n")
    const input = editInput('s-tests', file, "it('adds', () => {})", "it('adds', () => {})\nit('subtracts', () => {})")

    expect(reasonOf(await handleHook('pre-edit', input, env()))).toMatch(/^jig\/tests: the edit adds 1 test case/)
    expect(await handleHook('pre-edit', input, env())).toBe('')
  })

  it('journals a subagent start with role paths cut to role names', async () => {
    const input = JSON.stringify({
      session_id: 's-sub',
      cwd: project,
      hook_event_name: 'SubagentStart',
      agent_id: 'ag-1',
      agent_type: 'general-purpose',
      prompt: 'Read /p/skills/jig/references/roles/implementer.md, then fix src/a.ts',
    })

    expect(await handleHook('subagent-start', input, env())).toBe('')
    const record = readJournal(project).find((entry) => entry.kind === 'subagent-start')
    expect(record).toMatchObject({ agent: 'ag-1', rule: 'general-purpose', message: 'Read role implementer, then fix src/a.ts' })
  })
})

describe('user-prompt-submit declares the Figma reference of the branch', () => {
  const FRAME = 'https://www.figma.com/design/AbC123/Screens?node-id=12-34&t=x'
  const OTHER = 'https://www.figma.com/file/ZzZ999/Other?node-id=5-6'
  const UI_PROFILE = '{ "ui": { "targets": [{ "name": "web", "runtime": "browser", "widths": [1280] }], "themes": [{ "name": "light" }] } }\n'

  let uiProject: string

  const ask = (prompt: string): Promise<string> =>
    handleHook('user-prompt-submit', JSON.stringify({ session_id: 's-ui', cwd: uiProject, hook_event_name: 'UserPromptSubmit', prompt }), {
      CLAUDE_PROJECT_DIR: uiProject,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    })

  const contextOf = (output: string): string => (JSON.parse(output) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext

  beforeEach(() => {
    uiProject = mkdtempSync(join(tmpdir(), 'jig-adapter-ui-'))
    git(['init', '-q', '-b', 'feat-x'], uiProject)
  })

  afterEach(() => {
    rmSync(uiProject, { recursive: true, force: true })
  })

  const configure = (text: string): void => {
    mkdirSync(join(uiProject, '.jig'), { recursive: true })
    writeFileSync(join(uiProject, '.jig', 'config.jsonc'), text)
  }

  it('declares the reference and tells the agent what pre-mr will ask for', async () => {
    configure(UI_PROFILE)

    const context = contextOf(await ask(`Build the screen, design: ${FRAME}.`))

    expect(declaredReference(uiProject)).toBe(`figma:${FRAME}`)
    expect(context).toContain('flows/ui.md')
    expect(context).toContain(`jig ui mockup --figma ${FRAME} --component <node id>`)
    expect(context).toContain('jig ui reuse')
  })

  it('keeps a declared reference and says nothing for another Figma URL', async () => {
    configure(UI_PROFILE)
    await ask(FRAME)

    expect(await ask(`now use ${OTHER}`)).toBe('')
    expect(declaredReference(uiProject)).toBe(`figma:${FRAME}`)
  })

  it('does nothing without a ui profile or a node id', async () => {
    configure('{ "tsc": {} }\n')
    expect(await ask(FRAME)).toBe('')
    expect(declaredReference(uiProject)).toBeUndefined()

    configure(UI_PROFILE)
    expect(await ask('see https://www.figma.com/design/AbC123/Screens')).toBe('')
    expect(declaredReference(uiProject)).toBeUndefined()
  })
})
