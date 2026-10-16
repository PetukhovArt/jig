import { describe, expect, it } from 'vitest'
import { parseJsonc } from '../src/core/jsonc'

describe('parseJsonc', () => {
  it.each([
    ['plain json', '{"a": 1, "b": [true, null]}', { a: 1, b: [true, null] }],
    ['line comment', '{\n  // note\n  "a": 1\n}', { a: 1 }],
    ['block comment', '{ /* x */ "a": /* y */ 1 }', { a: 1 }],
    ['multi-line block comment', '{\n/*\n * many\n */\n"a": 1}', { a: 1 }],
    ['trailing comma in object', '{"a": 1,}', { a: 1 }],
    ['trailing comma in array', '[1, 2, ]', [1, 2]],
    ['trailing comma before comment', '{"a": [1, // last\n],\n}', { a: [1] }],
    ['slashes inside strings', '{"url": "https://x.dev/a//b", "c": "/* no */"}', { url: 'https://x.dev/a//b', c: '/* no */' }],
    ['escaped quote in string', '{"a": "say \\"hi\\" // not a comment"}', { a: 'say "hi" // not a comment' }],
    ['comma inside string before brace', '{"a": ",}"}', { a: ',}' }],
    ['byte order mark', '﻿{"a": 1}', { a: 1 }],
    ['comment at end of file', '{"a": 1} // end', { a: 1 }],
  ])('%s', (_name, text, expected) => {
    expect(parseJsonc(text)).toEqual(expected)
  })

  it.each([
    ['unterminated block comment', '{"a": 1 /* open'],
    ['missing value', '{"a": }'],
    ['single quotes', "{'a': 1}"],
  ])('rejects %s', (_name, text) => {
    expect(() => parseJsonc(text)).toThrow()
  })
})
