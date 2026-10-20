import { describe, expect, it } from 'vitest'
import { lexComments } from '../src/catalog/languages'
import { lexCSharp } from '../src/catalog/languages/csharp-lexer'
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

describe('csharp lexer', () => {
  const csharpTexts = (source: string): string[] => lexCSharp(source).map((comment) => comment.text)

  it.each([
    ['regular string', 'var a = "x // y /* z */";'],
    ['escaped quote and backslash', 'var a = "say \\"// no\\" \\\\"; var b = "/* no */";'],
    ['verbatim string', 'var a = @"C:\\dir\\"; var b = "// y /* z */";'],
    ['verbatim doubled quote', 'var a = @"""\\"; var b = "// y /* z */";'],
    ['multi-line verbatim string', 'var a = @"one\n// two\n/* three */\n";'],
    ['interpolated string', 'var a = $"x // {b} /* z */";'],
    ['interpolated brace escapes', 'var a = $"{{ // }} /* z */";'],
    ['interpolated verbatim string', 'var a = $@"{b}\\ // x\n/* y */";'],
    ['verbatim interpolated string', 'var a = @$"{b}\\"; var c = "// x /* y */";'],
    ['nested string in a hole', 'var a = $"{(b ? "// x" : "/* y */")} // z";'],
    ['nested interpolation', 'var a = $"{$"{b} // x"} {$@"/* y */"} // z";'],
    ['char literals', "var a = '/'; var b = '\\''; var c = '\"'; var d = \"// x\";"],
    ['raw string', 'var a = """\n    // x\n    /* y */ "" quoted\n    """;'],
    ['raw string with a longer delimiter', 'var a = """"\n    """ // x\n    """";'],
    ['interpolated raw string', 'var a = $"""\n    {F(""" // x """)} {c switch { _ => "/* y */" }}\n    """;'],
    ['double-dollar raw string', 'var a = $$"""\n    { // x } {{F(""" /* y */ """)}}\n    """;'],
    ['preprocessor directives', '#region Helpers // x\n#if DEBUG\nvar a = 1;\n#endif\n#endregion'],
    ['verbatim identifier', 'var @class = 1;'],
  ])('finds no comment in a %s', (_, source) => {
    expect(csharpTexts(source)).toEqual([])
  })

  it('finds comments after strings, in holes and as XML docs', () => {
    const source = [
      '/// <summary>Streams the frame.</summary>',
      'var a = "//" + @"""" + $"{b /* one */}"; // two',
      'var c = $"""',
      '    {d // three',
      '    }',
      '    """; /* four */',
    ].join('\n')
    expect(lexCSharp(source).map(({ text, line, kind }) => ({ text, line, kind }))).toEqual([
      { text: '/// <summary>Streams the frame.</summary>', line: 1, kind: 'line' },
      { text: '/* one */', line: 2, kind: 'block' },
      { text: '// two', line: 2, kind: 'line' },
      { text: '// three', line: 4, kind: 'line' },
      { text: '/* four */', line: 6, kind: 'block' },
    ])
  })

  it('reads compiler check directives apart from their trailing comment', () => {
    const source = '#pragma warning disable CS0618 // vendor API\r\n#nullable enable\n#if DEBUG // local only\n#endif'
    expect(lexCSharp(source).map(({ text, line, kind }) => ({ text, line, kind }))).toEqual([
      { text: '#pragma warning disable CS0618', line: 1, kind: 'directive' },
      { text: '// vendor API', line: 1, kind: 'line' },
      { text: '#nullable enable', line: 2, kind: 'directive' },
      { text: '// local only', line: 3, kind: 'line' },
    ])
  })

  it('counts lines across multi-line verbatim and raw strings', () => {
    const source = 'var a = @"x\ny";\nvar b = """\n    z\n    """;\n// after'
    expect(lexCSharp(source)).toMatchObject([{ text: '// after', line: 6 }])
  })
})

describe('scope', () => {
  it.each(['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.vue', 'A.cs'])('lexes %s', (file) => {
    expect(lexComments(file, '// x')).toHaveLength(1)
  })

  it.each(['a.css', 'a.md', 'a.json', 'a.yml', 'a.html', 'a.ipynb'])('skips %s', (file) => {
    expect(lexComments(file, '// x')).toBeUndefined()
  })
})
