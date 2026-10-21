import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDocRefs } from '../src/atoms/doc-refs'

const REPO_ROOT = resolve(import.meta.dirname, '..')

const DEFAULT_FILES: Record<string, string> = {
  'README.md': 'Run `/jig <task>` (fallback `/jig:jig`), or `/jig-slots`.\n\n| [flow-a](skills/jig/flows/flow-a.md) | a |\n',
  'skills/jig/SKILL.md': 'See `references/loop.md` and [the flow](flows/flow-a.md#steps).\n',
  'skills/jig/references/loop.md': 'Back to [the skill](../SKILL.md) or `references/roles/<name>.md`.\n',
  'skills/jig/flows/flow-a.md': '# flow-a\n',
  'skills/jig/flows/mr.md': '# mr\n',
  'skills/jig-slots/SKILL.md': 'Paths stay in `~/.jig/slots/` and [docs](https://example.com/x.md).\n',
}

const roots: string[] = []

const makePluginRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'jig-doc-refs-'))
  roots.push(root)
  for (const [path, text] of Object.entries({ ...DEFAULT_FILES, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('validateDocRefs', () => {
  it('accepts the docs of the repository', () => {
    expect(validateDocRefs(REPO_ROOT)).toEqual([])
  })

  it('accepts the minimal plugin', () => {
    expect(validateDocRefs(makePluginRoot({}))).toEqual([])
  })

  it.each([
    ['unknown slash command', { 'docs/a.md': 'Then run\n`/jig-vidoe`.\n' }, 'docs/a.md:2: /jig-vidoe names no skill in skills/'],
    ['unknown prefixed skill', { 'docs/a.md': 'Run /jig:jig-slot now.\n' }, 'docs/a.md:1: /jig:jig-slot names no skill in skills/'],
    ['broken relative link', { 'skills/jig/SKILL.md': 'See [x](references/gone.md "title").\n' }, 'skills/jig/SKILL.md:1: link references/gone.md points at no file'],
    ['missing skill-relative path', { 'skills/jig/flows/flow-a.md': '# flow-a\n\nUse `references/forge.md`.\n' }, 'skills/jig/flows/flow-a.md:3: `references/forge.md` points at no file'],
    ['missing root path', { 'README.md': `${DEFAULT_FILES['README.md']}Edit \`skills/jig/references/roles.md\`.\n` }, 'README.md:4: `skills/jig/references/roles.md` points at no file'],
    ['flow missing from the README table', { 'skills/jig/flows/flow-b.md': '# flow-b\n' }, 'README.md:3: flow flow-b is missing from the flow table'],
    ['README lists a flow that does not exist', { 'README.md': `${DEFAULT_FILES['README.md']}| [flow-z](./skills/jig/flows/flow-z.md) | z |\n` }, 'README.md:4: link ./skills/jig/flows/flow-z.md points at no file'],
  ])('reports %s', (_name, files, expected) => {
    const errors = validateDocRefs(makePluginRoot(files))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(expected)
  })
})
