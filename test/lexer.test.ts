import { describe, expect, it } from 'vitest'
import { lexComments } from '../src/catalog/languages'
import { lexJs, lexVue } from '../src/catalog/languages/js-lexer'

const texts = (source: string): string[] => lexJs(source).map((comment) => comment.text)

describe('js lexer', () => {
  it.each([
    ['single quotes', "const a = 'x // y /* z */'"],
    ['double quotes', 'const a = "x // y"'],
    ['escaped quote', "const a = 'it\\'s // fine'"],
    ['template', 'const a = `x // y /* z */`'],
    ['template expression with string', 'const a = `${"// x"} ${`/* y */`}`'],
    ['template expression with object', 'const a = `${{ b: "//" }.b} // still template`'],
    ['regex with slashes', 'const r = /\\/\\//g'],
    ['regex with class', 'const r = /[/]+/'],
    ['regex after return', 'function f() { return /\\/\\*x/ }'],
    ['shebang', '#!/usr/bin/env node\nrun()'],
  ])('finds no comment in %s', (_, source) => {
    expect(texts(source)).toEqual([])
  })

  it('finds comments after division and inside template expressions', () => {
    const source = 'const a = b / c // one\nconst t = `${x /* two */}`\nconst s = `${`${y}` // three\n}`'
    expect(texts(source)).toEqual(['// one', '/* two */', '// three'])
  })

  it('counts lines across strings, templates and block comments', () => {
    const source = 'const t = `a\nb`\n/* x\ny */\n// z\nconst s = "q"'
    expect(lexJs(source).map(({ line, kind }) => ({ line, kind }))).toEqual([
      { line: 3, kind: 'block' },
      { line: 5, kind: 'line' },
    ])
  })

  it('keeps the shebang out and the next line numbered from the file start', () => {
    expect(lexJs('#!/usr/bin/env node\n// hi')).toMatchObject([{ text: '// hi', line: 2 }])
  })

  it('strips the carriage return of a CRLF line comment', () => {
    expect(texts('// a\r\nconst b = 1')).toEqual(['// a'])
  })
})

describe('vue lexer', () => {
  const source = [
    '<template>',
    '  <div title="// no">',
    '    <!-- one -->',
    '  </div>',
    '</template>',
    '<script setup lang="ts">',
    "const a = '<!-- no -->'",
    '// two',
    '</script>',
    '<style>',
    '/* skipped */',
    '<!-- skipped -->',
    '</style>',
  ].join('\n')

  it('reads template html comments and script comments with file line numbers', () => {
    expect(lexVue(source).map(({ text, line }) => ({ text, line }))).toEqual([
      { text: '<!-- one -->', line: 3 },
      { text: '// two', line: 8 },
    ])
  })

  it('lexes a fragment without SFC blocks as script', () => {
    expect(lexVue('const a = 1 // x').map((comment) => comment.text)).toEqual(['// x'])
  })
})

describe('scope', () => {
  it.each(['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.vue'])('lexes %s', (file) => {
    expect(lexComments(file, '// x')).toHaveLength(1)
  })

  it.each(['a.css', 'a.md', 'a.json', 'a.yml', 'a.html', 'a.ipynb'])('skips %s', (file) => {
    expect(lexComments(file, '// x')).toBeUndefined()
  })
})
