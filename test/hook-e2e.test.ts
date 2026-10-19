import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'

const pluginRoot = resolve(__dirname, '..')
const bin = join(pluginRoot, 'bin', 'jig.mjs')
const typescriptDir = join(pluginRoot, 'node_modules', 'typescript')
const hasTypescript = existsSync(join(typescriptDir, 'package.json'))

let root: string

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const hook = (name: string, input: Record<string, unknown>): string => {
  const payload = { session_id: 'e2e', transcript_path: join(root, 't.jsonl'), cwd: root, permission_mode: 'default', ...input }
  const result = spawnSync(process.execPath, [bin, 'hook', name], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: pluginRoot },
  })
  expect(result.status).toBe(0)
  return result.stdout
}

const preWrite = (file: string, content: string): string =>
  hook('pre-edit', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(root, file), content } })

const postWrite = (file: string, content: string): string => {
  write(file, content)
  return hook('post-edit', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: join(root, file), content },
    tool_response: {},
  })
}

const stop = (): string => hook('stop', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'done' })

const denialOf = (output: string): string => JSON.parse(output).hookSpecificOutput.permissionDecision

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-e2e-'))
  git(['init', '-q'], root)
  write('.gitignore', 'node_modules/\n')
  write('tsconfig.json', '{ "compilerOptions": { "strict": true, "noEmit": true, "types": [] }, "include": ["src"] }\n')
  write('src/a.ts', 'export const a = 1\n')
  write('.jig/config.jsonc', '{ "tools": { "tsc": {} } }\n')
  git(['add', '-A'], root)
  git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'init'], root)
  if (hasTypescript) {
    mkdirSync(join(root, 'node_modules'))
    symlinkSync(typescriptDir, join(root, 'node_modules', 'typescript'), 'junction')
  }
  hook('session-start', { hook_event_name: 'SessionStart', source: 'startup' })
  hook('user-prompt-submit', { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('hooks through bin/jig.mjs', () => {
  it('denies a new suppression every time', () => {
    const content = `// @ts-${'nocheck'}\nexport const b = 2\n`
    expect(denialOf(preWrite('src/b.ts', content))).toBe('deny')
    expect(denialOf(preWrite('src/b.ts', content))).toBe('deny')
  })

  it('denies the first narrating comment once the comment gate is on, then lets the same call pass', () => {
    write('.jig/config.jsonc', '{ "rules": { "jig/comments": "error" }, "tools": { "tsc": {} } }\n')
    const content = 'let i = 0\n// increments i\ni++\n'
    expect(denialOf(preWrite('src/b.ts', content))).toBe('deny')
    expect(preWrite('src/b.ts', content)).toBe('')
  })

  it('says once at session start that the project drifted from its config', () => {
    write('.oxlintrc.json', '{}\n')
    const context: string = JSON.parse(hook('session-start', { hook_event_name: 'SessionStart', source: 'startup' })).hookSpecificOutput.additionalContext
    expect(context.split('\n')).toHaveLength(1)
    expect(context).toMatch(/^jig: found oxlint, not in config.*\. Run jig init --update to settle the project config\.$/)
  })

  it('answers nothing to a clean edit', () => {
    expect(preWrite('src/b.ts', 'export const b = 2\n')).toBe('')
    expect(postWrite('docs/notes.txt', 'plain notes\n')).toBe('')
  })

  it.runIf(hasTypescript)('blocks stop on a type error and lets it pass after the fix', () => {
    postWrite('src/a.ts', "export const a: number = 'one'\n")
    const blocked = JSON.parse(stop())
    expect(blocked.decision).toBe('block')
    expect(blocked.reason).toContain('src/a.ts:1 TS2322')
    postWrite('src/a.ts', 'export const a: number = 1\n')
    expect(stop()).toBe('')
  })

  it.runIf(hasTypescript)('lets stop pass over an old type error on a line the turn did not change', () => {
    write('src/old.ts', "export const old: number = 'legacy'\n")
    git(['add', '-A'], root)
    git(['-c', 'user.email=jig@test', '-c', 'user.name=jig', 'commit', '-q', '-m', 'legacy'], root)
    hook('user-prompt-submit', { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
    postWrite('src/old.ts', "export const old: number = 'legacy'\nexport const fresh = 2\n")
    expect(stop()).toBe('')
  })
})
