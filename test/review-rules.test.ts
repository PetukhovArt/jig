import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { reviewInputs } from '../src/review/rules'

let root: string

const write = (path: string, text = 'x\n'): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const sh = (...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  if (!result.ok) throw new Error(result.stderr)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-rules-'))
  sh('init', '-q', '-b', 'main')
  for (const path of ['AGENTS.md', 'src/payments/AGENTS.md', 'src/payments/deep/REVIEW.md', 'src/other/CLAUDE.md', 'standards/naming.md', 'notes/code-style.md', 'docs/architecture.md', 'docs/adr/0001-layers.md', 'src/payments/deep/pay.ts']) {
    write(path)
  }
  sh('add', '-A')
  sh('commit', '-q', '-m', 'base')
  sh('checkout', '-q', '-b', 'feature')
  write('src/payments/deep/pay.ts', 'changed\n')
  write('src/payments/deep/my folder/new file.ts', 'new\n')
  sh('add', '-A')
  sh('commit', '-q', '-m', 'work')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('review inputs', () => {
  it('walks up from every changed file, paths with spaces included, and lists standards', () => {
    expect(reviewInputs(root, 'main', [], {})).toEqual({
      indexes: ['AGENTS.md', 'src/payments/AGENTS.md', 'src/payments/deep/REVIEW.md'],
      standards: ['notes/code-style.md', 'standards/naming.md'],
      glossaries: [],
      scopes: { 'AGENTS.md': '', 'src/payments/AGENTS.md': 'src/payments', 'src/payments/deep/REVIEW.md': 'src/payments/deep', 'notes/code-style.md': '', 'standards/naming.md': '' },
      avoid: [],
    })
  })

  it('lists the root glossary and the context glossaries its map lists, each scoped to its own directory', () => {
    write('AGENTS.md', 'Glossary: [GLOSSARY-MAP.md](GLOSSARY-MAP.md)\n')
    write('GLOSSARY-MAP.md', '- [Common](./GLOSSARY.md)\n- [payments](./src/payments/GLOSSARY.md)\n')
    write('GLOSSARY.md', '**Channel**\n_Avoid_: camera\n')
    write('src/payments/GLOSSARY.md', '**Invoice**\n')
    write('src/other/GLOSSARY.md', '**Unlisted**\n')
    const inputs = reviewInputs(root, 'main', [], {})
    expect(inputs.glossaries).toEqual(['GLOSSARY.md', 'src/payments/GLOSSARY.md'])
    expect([inputs.scopes['GLOSSARY.md'], inputs.scopes['src/payments/GLOSSARY.md']]).toEqual(['', 'src/payments'])
  })

  it('reports added names that the _Avoid_ line of a glossary on the walk up lists, within its scope only, with no index or map linking it', () => {
    write('src/payments/deep/GLOSSARY.md', '**Enabled**: the operator can open the tab at runtime\n_Avoid_: disabled, blocked (use **Locked** for design time)\n')
    write('src/other/GLOSSARY.md', '_Avoid_: pay\n')
    write('src/payments/deep/pay.ts', 'changed\nexport const isDisabled = props.enabled\nconst label = "Blocked"\nconst disabledTabs = []\n')
    const { glossaries, avoid } = reviewInputs(root, 'main', [], {})
    expect(glossaries).toEqual(['src/payments/deep/GLOSSARY.md'])
    expect(avoid.map((hit) => `${hit.file}:${hit.line} ${hit.word} ${hit.lines} ${hit.glossary}:${hit.glossaryLine}`)).toEqual([
      'src/payments/deep/pay.ts:2 disabled 2 src/payments/deep/GLOSSARY.md:2',
      'src/payments/deep/pay.ts:3 blocked 1 src/payments/deep/GLOSSARY.md:2',
    ])
  })

  it('lists the standards under docs/ that an index links, scoped to the directory of the shallowest index linking them', () => {
    write('AGENTS.md', '- [code/naming.md](docs/standards/code/naming.md) - function naming\n')
    write('src/payments/AGENTS.md', 'See [money](../../docs/standards/code/money.md#rounding).\n')
    write('docs/standards/code/naming.md')
    write('docs/standards/code/money.md')
    write('docs/standards/tracker/gitlab.md')
    write('docs/review.md')
    const inputs = reviewInputs(root, 'main', [], {})
    expect(inputs.standards).toEqual(['docs/standards/code/money.md', 'docs/standards/code/naming.md', 'notes/code-style.md', 'standards/naming.md'])
    expect([inputs.scopes['docs/standards/code/naming.md'], inputs.scopes['docs/standards/code/money.md']]).toEqual(['', 'src/payments'])
  })

  it('takes the index names, standards and exclusions from .jig/review.jsonc, and REVIEW_RULES over the standards', () => {
    write('.jig/review.jsonc', '{ "discover": { "rules": ["REVIEW.md"], "standards": ["docs/**/*.md"], "exclude": ["docs/adr/**"] } }')
    expect(reviewInputs(root, 'main', [], {})).toMatchObject({
      indexes: ['src/payments/deep/REVIEW.md'],
      standards: ['docs/architecture.md', 'notes/code-style.md', 'standards/naming.md'],
    })
    expect(reviewInputs(root, 'main', [], { REVIEW_RULES: 'notes/*.md' }).standards).toEqual(['notes/code-style.md'])
  })
})
