import { describe, expect, it } from 'vitest'
import { FrontmatterError, parseFrontmatter } from '../src/core/frontmatter'

const doc = (...lines: string[]): string => lines.join('\n')

describe('parseFrontmatter', () => {
  it.each([
    ['plain scalar', doc('---', 'name: comments', '---', 'body'), { name: 'comments' }],
    ['double-quoted scalar', doc('---', 'description: "Apply when x. Do y: z"', '---'), { description: 'Apply when x. Do y: z' }],
    ['escapes in double quotes', doc('---', 'a: "q \\"x\\" \\\\ \\u00e9"', '---'), { a: 'q "x" \\ é' }],
    ['single-quoted scalar', doc('---', "a: 'it''s # not a comment'", '---'), { a: "it's # not a comment" }],
    ['trailing comment on plain scalar', doc('---', 'a: value # note', '---'), { a: 'value' }],
    ['hash without space stays', doc('---', 'a: issue#12', '---'), { a: 'issue#12' }],
    ['flow array', doc('---', 'paths: ["**/*.ts", \'src/*.vue\', plain]', '---'), { paths: ['**/*.ts', 'src/*.vue', 'plain'] }],
    ['flow array with comment', doc('---', 'paths: ["a", "b"]   # optional', '---'), { paths: ['a', 'b'] }],
    ['empty flow array', doc('---', 'paths: []', '---'), { paths: [] }],
    ['comma inside quoted item', doc('---', 'paths: ["{a,b}/*.ts"]', '---'), { paths: ['{a,b}/*.ts'] }],
    ['block array', doc('---', 'paths:', '  - "a/**"', '  - b/*.ts', 'name: x', '---'), { paths: ['a/**', 'b/*.ts'], name: 'x' }],
    ['nested map', doc('---', 'metadata:', '  tier: deep', '', '  # c', "  effort: 'high'", 'name: x', '---'), { metadata: { tier: 'deep', effort: 'high' }, name: 'x' }],
    ['empty value', doc('---', 'a:', '---'), { a: '' }],
    ['blank and comment lines', doc('---', '', '# c', 'a: 1', '---'), { a: '1' }],
    ['crlf line endings', '---\r\nname: x\r\n---\r\nbody', { name: 'x' }],
  ])('%s', (_name, text, expected) => {
    expect(parseFrontmatter(text)?.data).toEqual(expected)
  })

  it('returns the body after the closing fence', () => {
    const parsed = parseFrontmatter(doc('---', 'name: x', '---', 'line 1', 'line 2'))
    expect(parsed?.body).toBe('line 1\nline 2')
    expect(parsed?.bodyLine).toBe(4)
  })

  it('returns undefined when the text has no frontmatter', () => {
    expect(parseFrontmatter('# Title\n---\na: 1\n---')).toBeUndefined()
  })

  it.each([
    ['missing closing fence', doc('---', 'a: 1'), 2],
    ['line without a key', doc('---', 'a: 1', 'just text', '---'), 3],
    ['duplicate key', doc('---', 'a: 1', 'a: 2', '---'), 3],
    ['unterminated quote', doc('---', 'a: "open', '---'), 2],
    ['unterminated array', doc('---', 'a: ["x", "y"', '---'), 2],
    ['text after quoted value', doc('---', 'a: "x" y', '---'), 2],
    ['invalid escape', doc('---', 'a: "\\q"', '---'), 2],
    ['map entry without a value', doc('---', 'metadata:', '  tier: deep', '  effort:', '---'), 4],
    ['inconsistent map indentation', doc('---', 'metadata:', '  tier: deep', '    effort: high', '---'), 4],
    ['duplicate map key', doc('---', 'metadata:', '  tier: deep', '  tier: fast', '---'), 4],
    ['array in a map', doc('---', 'metadata:', '  tier: [deep]', '---'), 3],
  ])('rejects %s with its line', (_name, text, line) => {
    let caught: unknown
    try {
      parseFrontmatter(text)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(FrontmatterError)
    expect((caught as FrontmatterError).line).toBe(line)
  })
})
