import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateAtoms } from '../src/atoms/atoms'
import { readAtomIndex } from '../src/core/plan'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const VALID_DESCRIPTION = 'Apply when you test the validator. Keep it short.'

const atomText = (frontmatter: string[], bodyLines = ['# Probe', '- one rule']): string =>
  ['---', ...frontmatter, '---', ...bodyLines, ''].join('\n')

const validAtom = (name: string, extra: string[] = []): string =>
  atomText([`name: ${name}`, `description: "${VALID_DESCRIPTION}"`, ...extra])

const roots: string[] = []

const makePluginRoot = (atoms: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'jig-atoms-'))
  roots.push(root)
  mkdirSync(join(root, 'atoms'))
  mkdirSync(join(root, 'skills', 'jig', 'flows'), { recursive: true })
  writeFileSync(join(root, 'skills', 'jig', 'SKILL.md'), 'Read atom `probe` first.\n\n- `indexed`: Apply when indexed.\n')
  writeFileSync(join(root, 'skills', 'jig', 'flows', 'review.md'), '# Review\n\nAtoms: listed, other, Probe_X.\n')
  for (const [file, text] of Object.entries(atoms)) {
    writeFileSync(join(root, 'atoms', file), text)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('validateAtoms', () => {
  it('accepts all 27 atoms of the repository', () => {
    expect(readAtomIndex(REPO_ROOT)).toHaveLength(27)
    expect(validateAtoms(REPO_ROOT)).toEqual([])
  })

  it.each(['listed', 'indexed'])('accepts an atom %s in an "Atoms:" line of a flow or an index line of SKILL.md', (name) => {
    expect(validateAtoms(makePluginRoot({ [`${name}.md`]: validAtom(name) }))).toEqual([])
  })

  it.each([
    ['1. no frontmatter', 'probe.md', '# Probe\n', 'atoms/probe.md: frontmatter is missing'],
    ['1. unparsable frontmatter', 'probe.md', atomText(['name: probe', 'not a key line']), 'atoms/probe.md: frontmatter is invalid'],
    ['1. extra key', 'probe.md', validAtom('probe', ['tags: [x]']), 'atoms/probe.md: unknown frontmatter key "tags"'],
    ['2. name differs from file', 'probe.md', validAtom('other'), 'atoms/probe.md: name "other" does not match file name'],
    ['2. name not kebab-case', 'Probe_X.md', validAtom('Probe_X'), 'atoms/Probe_X.md: name "Probe_X" is not kebab-case'],
    ['3. description start', 'probe.md', atomText(['name: probe', 'description: "Use when testing."']), 'atoms/probe.md: description must match'],
    ['3. description lines', 'probe.md', atomText(['name: probe', 'description: "Apply when a.\\nb"']), 'atoms/probe.md: description must be one line'],
    ['3. description length', 'probe.md', atomText(['name: probe', `description: "Apply to ${'x'.repeat(300)}"`]), 'atoms/probe.md: description is longer than 300'],
    ['4. body length', 'probe.md', atomText(['name: probe', `description: "${VALID_DESCRIPTION}"`], Array.from({ length: 36 }, (_, i) => `- ${i}`)), 'atoms/probe.md: body is longer than 35 lines'],
    ['5. unreachable', 'lonely.md', validAtom('lonely'), 'atoms/lonely.md: atom is unreachable'],
  ])('%s', (_name, file, text, expected) => {
    const errors = validateAtoms(makePluginRoot({ [file]: text }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(expected)
  })

  it('2. reports a duplicate name', () => {
    const root = makePluginRoot({ 'probe.md': validAtom('probe'), 'z-copy.md': validAtom('probe') })
    expect(validateAtoms(root)).toContain('atoms/z-copy.md: duplicate name "probe"')
  })
})
