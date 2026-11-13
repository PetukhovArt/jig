import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { git } from '../src/core/git'

type Before = (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => Promise<void>

const pluginUrl = pathToFileURL(join(resolve(__dirname, '..'), 'opencode', 'jig.mjs')).href

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-opencode-'))
  git(['init', '-q'], root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

it('blocks an OpenCode write that jig denies through bin/jig.mjs, and passes a clean one', async () => {
  const { JigPlugin } = await import(pluginUrl)
  const hooks = await JigPlugin({ client: {}, directory: root, worktree: root })
  const before: Before = hooks['tool.execute.before']
  const write = (callID: string, content: string): Promise<void> => before({ tool: 'write', sessionID: 'oc', callID }, { args: { filePath: join(root, 'b.ts'), content } })
  await expect(write('c1', `// @ts-${'nocheck'}\nexport const b = 2\n`)).rejects.toThrow(/nocheck/)
  await expect(write('c2', 'export const b = 2\n')).resolves.toBeUndefined()
})
