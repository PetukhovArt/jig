import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig, type JigConfig } from '../src/core/config'
import { gateEdit } from '../src/rules/gate'
import type { Edit } from '../src/rules/rule'

interface Replacement {
  old_string: string
  new_string: string
}

type Input = { content: string } | { edits: Replacement[] }
type Case = [name: string, file: string, before: string | null, input: Input]

const write = (content: string): Input => ({ content })
const edit = (old_string: string, new_string: string): Input => ({ edits: [{ old_string, new_string }] })

const BLOCKED: Case[] = [
  ['ts line comment in a new file', 'a.ts', null, write('const a = 1 // note\n')],
  ['ts block comment added by an edit', 'a.ts', 'const a = 1\n', edit('const a = 1', '/* why */\nconst a = 1')],
  ['ts JSDoc', 'a.ts', 'export const a = 1\n', edit('export', '/** The a. */\nexport')],
  ['eslint-disable directive', 'a.ts', 'run()\n', edit('run()', '// eslint-disable-next-line no-console\nrun()')],
  ['oxlint and biome directives', 'a.js', 'run()\n', edit('run()', '// oxlint-disable-next-line\n// biome-ignore lint: x\nrun()')],
  ['@ts-expect-error', 'a.ts', 'run()\n', edit('run()', '// @ts-expect-error\nrun()')],
  ['@ts-check', 'a.js', null, write('// @ts-check\nrun()\n')],
  ['/// reference', 'a.ts', null, write('/// <reference types="vite/client" />\n')],
  ['@vitest-environment', 'a.test.ts', null, write(`// @vitest-${'environment'} jsdom\nit()\n`)],
  ['license header in a new file', 'a.ts', null, write('/*! MIT License */\nexport {}\n')],
  ['comment in a template literal hole', 'a.ts', 'const s = ``\n', edit('``', '`${a /* c */}`')],
  ['JSX expression comment', 'a.tsx', 'const v = <div></div>\n', edit('<div></div>', '<div>{/* note */}</div>')],
  ['comment after a regex', 'a.js', 'const r = /a/\n', edit('/a/', '/a\\//g // note')],
  ['edited text of an existing comment', 'a.ts', '// old\nrun()\n', edit('// old', '// new')],
  ['second copy of an existing comment', 'a.ts', '// same\nrun()\n', edit('run()', 'run()\n// same')],
  ['one of several MultiEdit edits', 'a.ts', 'a()\nb()\n', { edits: [{ old_string: 'a()', new_string: 'a(1)' }, { old_string: 'b()', new_string: 'b() // x' }] }],
  ['vue template comment', 'a.vue', '<template>\n  <div />\n</template>\n', edit('<div />', '<!-- note -->\n  <div />')],
  ['vue prettier-ignore', 'a.vue', '<template>\n  <div />\n</template>\n', edit('<div />', '<!-- prettier-ignore -->\n  <div />')],
  ['vue script comment', 'a.vue', '<script setup lang="ts">\nconst a = 1\n</script>\n', edit('const a = 1', 'const a = 1 // note')],
  ['vue scss line comment', 'a.vue', '<style lang="scss">\n.a { color: red; }\n</style>\n', edit('.a', '// note\n.a')],
  ['css block comment', 'a.css', '.a { color: red; }\n', edit('.a', '/* note */\n.a')],
  ['html comment', 'a.html', '<p>x</p>\n', edit('<p>x</p>', '<p>x</p>\n<!-- note -->')],
  ['html script comment', 'a.html', '<script>\nrun()\n</script>\n', edit('run()', 'run() // note')],
  ['python comment', 'a.py', 'x = 1\n', edit('x = 1', 'x = 1  # note')],
  ['python noqa and type ignore', 'a.py', 'import os\n', edit('import os', 'import os  # noqa\ny = f()  # type: ignore')],
  ['shell comment after the shebang', 'a.sh', null, write('#!/bin/sh\n# note\necho hi\n')],
  ['rust doc comment', 'a.rs', 'fn a() {}\n', edit('fn a', '/// Does a.\nfn a')],
  ['rust nested block comment', 'a.rs', 'fn a() {}\n', edit('fn a() {}', 'fn a() { /* x /* y */ z */ }')],
  ['go directive', 'a.go', 'package a\n', edit('package a', 'package a\n\n//go:generate stringer')],
  ['go build tag', 'a.go', 'package a\n', edit('package a', '// +build linux\n\npackage a')],
  ['c# comment', 'a.cs', 'class A {}\n', edit('class A {}', 'class A {} // note')],
  ['c# pragma', 'a.cs', 'class A {}\n', edit('class A {}', '#pragma warning disable CS0168\nclass A {}')],
  ['c# region', 'a.cs', 'class A {}\n', edit('class A {}', 'class A {\n    #region Fields\n    #endregion\n}')],
  ['c# comment in an interpolation hole', 'a.cs', 'var s = "";\n', edit('""', '$"{a /* c */}"')],
  ['edit whose old text is missing falls back to the new text', 'a.ts', 'a()\n', edit('zzz', 'b() // x')],
  ['word added to an existing comment', 'a.ts', '// keep\nrun()\n', edit('// keep', '// keep it')],
  ['line reworded in a JSDoc', 'a.ts', '/**\n * The a.\n * The b.\n */\nrun()\n', edit(' * The b.', ' * The c.')],
  ['part of a comment removed and a word added', 'a.ts', '// keep this, drop that\nrun()\n', edit('// keep this, drop that', '// keep this now')],
  ['comment shortened and a new one added', 'a.ts', '// keep this, drop that\nrun()\n', edit('// keep this, drop that', '// keep this\n// new')],
  ['block comment end removed swallows code', 'a.ts', '/* a */\nrun()\n/* b */\n', edit('/* a */', '/* a')],
]

const ALLOWED: Case[] = [
  ['code-only edit of a commented file', 'a.ts', '// keep\nconst a = 1\n', edit('const a = 1', 'const a = 2')],
  ['existing comment moved unchanged', 'a.ts', '// keep\na()\nb()\n', edit('// keep\na()\nb()', 'a()\n// keep\nb()')],
  ['comment removed', 'a.ts', '// gone\na()\n', edit('// gone\n', '')],
  ['block comment removed', 'a.ts', '/*\n * gone\n */\na()\n', edit('/*\n * gone\n */\n', '')],
  ['line removed from a block comment', 'a.ts', '/*\n * keep\n * drop\n */\na()\n', edit(' * drop\n', '')],
  ['line removed from a JSDoc', 'a.ts', '/**\n * The a.\n * @param x the x\n */\nexport const a = (x) => x\n', edit(' * @param x the x\n', '')],
  ['trailing part of a line comment removed', 'a.ts', 'a() // keep this, drop that\n', edit(' // keep this, drop that', ' // keep this')],
  ['words removed from a vue template comment', 'a.vue', '<template>\n  <!-- keep this, drop that -->\n  <div />\n</template>\n', edit('keep this, drop that', 'keep this')],
  ['part of a comment removed in a fallback edit', 'a.ts', 'a()\n', edit('zzz // keep this, drop that', 'zzz // keep this')],
  ['existing directive kept on rewrite', 'a.ts', '// eslint-disable-next-line\nrun()\n', write('// eslint-disable-next-line\nrun(1)\n')],
  ['strings with slashes and hashes', 'a.ts', null, write('const u = "http://x/*y*/"\nconst c = \'#fff // z\'\n')],
  ['regex with slashes', 'a.js', null, write('const r = /\\/\\//g\nconst s = /[/]/\nconst t = x.split(/\\/\\*/)\n')],
  ['division then regex', 'a.js', null, write('const q = a / b / c\nif (x) return /\\/\\//.test(y)\n')],
  ['template literal text', 'a.ts', null, write('const t = `a // b ${c} /* d */ ${`e // f`}`\n')],
  ['JSX text', 'a.tsx', null, write('const v = <a href="http://x">http://x // y /* z */ <b>{u}</b></a>\n')],
  ['JSX attribute string', 'a.jsx', null, write('const v = <img src="//cdn/a.png" alt=\'/* x */\' />\n')],
  ['tsx generic arrow before JSX', 'a.tsx', null, write('export const F = <T extends X = \'div\'>(p: T) => <a href="//x">a // b</a>\nconst G = <U,>(u: U) => u\nconst H = <V = unknown,>(v: V) => <b>//</b>\n')],
  ['ts generics and comparisons', 'a.ts', null, write('const m = new Map<string, number>()\nconst b = a < c && d > e\n')],
  ['scss url and string', 'a.scss', null, write('.a { background: url(//cdn/a.png); content: "/* x */ // y"; }\n')],
  ['css protocol-relative url', 'a.css', null, write('@import url(//fonts/x.css);\n')],
  ['vue template attribute with slashes', 'a.vue', null, write('<template>\n  <a href="http://x" :title="a // b">//</a>\n</template>\n')],
  ['python strings and docstring', 'a.py', null, write('s = "#fff"\nt = \'a # b\'\nu = """\n# not\n"""\n')],
  ['shell shebang, hash in words and heredoc', 'a.sh', null, write('#!/usr/bin/env bash\necho "#x" a#b $# ${#v} \'#q\'\ncat <<EOF\n# inside\nEOF\nn=$((1 << 2))\n')],
  ['js shebang only', 'a.mjs', null, write('#!/usr/bin/env node\nrun()\n')],
  ['rust strings, raw strings and lifetimes', 'a.rs', null, write('fn f<\'a>(x: &\'a str) { let s = "// x"; let r = r#"/* y */"#; let c = \'/\'; }\n')],
  ['go raw string', 'a.go', null, write('package a\n\nvar s = `// x /* y */`\nvar u = "http://x"\n')],
  ['c# verbatim, raw and interpolated strings', 'a.cs', null, write('var p = @"C:\\dir\\";\nvar u = "http://x";\nvar r = """ // raw """;\nvar i = $"{a}//{{b}}";\n#if DEBUG\n#endif\n')],
  ['vite config', 'vite.config.ts', null, write('// note\nexport default {}\n')],
  ['rc dotfile', '.eslintrc.cjs', null, write('// note\nmodule.exports = {}\n')],
  ['json config', 'tsconfig.json', null, write('{\n  // note\n}\n')],
  ['yaml', 'ci.yml', null, write('# note\na: 1\n')],
  ['toml', 'Cargo.toml', null, write('# note\n')],
  ['Dockerfile', 'Dockerfile', null, write('# note\nFROM node\n')],
  ['.gitignore', '.gitignore', null, write('# note\n')],
  ['markdown', 'a.md', null, write('<!-- note -->\n')],
  ['unknown extension', 'a.foo', null, write('// note\n')],
]

const PLUGIN_ROOT = resolve(import.meta.dirname, '..')
const sandbox = mkdtempSync(join(tmpdir(), 'jig-comment-gate-'))

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

const editsOf = (before: string | null, input: Input): Edit[] =>
  'content' in input ? [{ before: before ?? '', after: input.content }] : input.edits.map((replacement) => ({ before: replacement.old_string, after: replacement.new_string }))

const decide = ([, file, before, input]: Case, config: JigConfig = defaultConfig()) => {
  const projectRoot = mkdtempSync(join(sandbox, 'case-'))
  if (before !== null) writeFileSync(join(projectRoot, file), before)
  const call = () => gateEdit({ projectRoot, pluginRoot: PLUGIN_ROOT, sessionId: 's', agent: 'main', file, edits: editsOf(before, input), config })
  return { first: call(), second: call() }
}

describe('comment gate', () => {
  it.each(BLOCKED)('blocks %s', (...item) => {
    expect(decide(item).first.reason).toBeDefined()
  })

  it.each(ALLOWED)('allows %s', (...item) => {
    expect(decide(item).first.reason).toBeUndefined()
  })

  it('cutting the tail of a line comment passes twice in a row', () => {
    const { first, second } = decide(['cut', 'a.ts', 'a() // keep this, drop that\n', edit(' // keep this, drop that', ' // keep this')])
    expect(first.reason).toBeUndefined()
    expect(second.reason).toBeUndefined()
  })

  it('adding a comment is denied twice in a row', () => {
    const { first, second } = decide(['add', 'src.ts', 'a()\nrun()\n', edit('run()', 'run() // note')])
    expect(first.reason).toMatch(/^jig\/comments: the edit adds or rewords 1 comment\(s\):\n {2}src\.ts:2 \/\/ note\n/)
    expect(second.reason).toBe(first.reason)
  })

  it('jig/comments off lets a new comment pass', () => {
    const config = defaultConfig()
    const off = { ...config, rules: { ...config.rules, 'jig/comments': 'off' as const } }
    expect(decide(['off', 'a.ts', 'run()\n', edit('run()', 'run() // note')], off).first.reason).toBeUndefined()
  })
})
