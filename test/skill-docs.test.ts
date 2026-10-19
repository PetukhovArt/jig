import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateSkillDocs } from '../src/atoms/skill-docs'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const ROLE = 'skills/jig/references/roles/probe.md'
const FLOW = 'skills/jig/flows/flow-a.md'

const doc = (frontmatter: string[], body = '# Body'): string => ['---', ...frontmatter, '---', body, ''].join('\n')

const role = (name: string, extra: string[] = [], metadata = ['  tier: deep', '  effort: high']): string =>
  doc([`name: ${name}`, 'description: "Use in flow-a step 1 to probe."', ...extra, 'metadata:', ...metadata])

const DEFAULT_FILES: Record<string, string> = {
  'skills/jig/SKILL.md': doc(['name: jig', 'description: "probe skill."'], 'Start with `flows/flow-a.md`.'),
  [ROLE]: role('probe'),
  [FLOW]: doc(['name: flow-a', 'description: "probe the validator."'], '# flow-a\n\n1. Spawn role `probe`.'),
}

const roots: string[] = []

const makePluginRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'jig-skill-docs-'))
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

describe('validateSkillDocs', () => {
  it('accepts the roles and flows of the repository', () => {
    expect(validateSkillDocs(REPO_ROOT)).toEqual([])
  })

  it('accepts the minimal plugin', () => {
    expect(validateSkillDocs(makePluginRoot({}))).toEqual([])
  })

  it('counts a role named in a "roles `a`, `b` and `c`" list as spawned', () => {
    const files = {
      'skills/jig/references/loop.md': 'Spawn roles `probe`, `second` and `third`.\n',
      'skills/jig/references/roles/second.md': role('second'),
      'skills/jig/references/roles/third.md': role('third'),
    }
    expect(validateSkillDocs(makePluginRoot(files))).toEqual([])
  })

  it.each([
    ['role without frontmatter', { [ROLE]: '# probe\n' }, `${ROLE}: frontmatter is missing`],
    ['role with broken frontmatter', { [ROLE]: doc(['name: probe', 'not a key']) }, `${ROLE}: frontmatter is invalid (line 3:`],
    ['role name differs from file', { [ROLE]: role('other') }, `${ROLE}: name "other" does not match file name "probe"`],
    ['role without description', { [ROLE]: doc(['name: probe', 'metadata:', '  tier: deep', '  effort: high']) }, `${ROLE}: description is missing`],
    ['multi-line description', { [ROLE]: role('probe').replace('probe."', 'probe.\\nmore"') }, `${ROLE}: description must be one line`],
    ['long description', { [ROLE]: role('probe').replace('probe."', `${'x'.repeat(200)}"`) }, `${ROLE}: description is longer than 200 characters`],
    ['unknown role key', { [ROLE]: role('probe', ['tier: deep']) }, `${ROLE}: unknown frontmatter key "tier"`],
    ['missing metadata', { [ROLE]: doc(['name: probe', 'description: "Use in x to y."']) }, `${ROLE}: metadata must be a block with tier and effort`],
    ['unknown tier', { [ROLE]: role('probe', [], ['  tier: huge', '  effort: high']) }, `${ROLE}: metadata.tier must be one of deep, standard, fast`],
    ['missing effort', { [ROLE]: role('probe', [], ['  tier: fast']) }, `${ROLE}: metadata.effort must be one of low, medium, high`],
    ['role mentioned only by another role', { 'skills/jig/references/roles/lonely.md': role('lonely'), [ROLE]: `${role('probe')}Hand off to role \`lonely\`.\n` }, 'skills/jig/references/roles/lonely.md: role is never spawned'],
    ['flow without frontmatter', { [FLOW]: '# flow-a\n\nSpawn role `probe`.\n' }, `${FLOW}: frontmatter is missing`],
    ['flow name differs from file', { [FLOW]: doc(['name: flow-b', 'description: "x."'], 'Spawn role `probe`.') }, `${FLOW}: name "flow-b" does not match file name "flow-a"`],
    ['mention of a missing role', { 'skills/jig/references/x.md': 'One line.\nSpawn role `prob`.\n' }, 'skills/jig/references/x.md:2: role `prob` does not exist'],
    ['mention of a missing flow', { 'skills/other/notes.md': 'Then `flows/flow-z.md`.\n' }, 'skills/other/notes.md:1: flows/flow-z.md does not exist'],
    ['skill name differs from folder', { 'skills/jig-x/SKILL.md': doc(['name: Jig X', 'description: "x."']) }, 'skills/jig-x/SKILL.md: name "Jig X" does not match folder name "jig-x"'],
    ['skill without frontmatter', { 'skills/jig-x/SKILL.md': '# x\n' }, 'skills/jig-x/SKILL.md: frontmatter is missing'],
    ['skill folder not kebab-case', { 'skills/Jig_X/SKILL.md': doc(['name: Jig_X', 'description: "x."']) }, 'skills/Jig_X/SKILL.md: folder name is not lowercase words joined by hyphens'],
  ])('reports %s', (_name, files, expected) => {
    const errors = validateSkillDocs(makePluginRoot(files))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(expected)
  })
})
