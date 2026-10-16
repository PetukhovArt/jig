import { describe, expect, it } from 'vitest'
import { createMatcher, matchGlob } from '../src/core/glob'

describe('matchGlob', () => {
  it.each([
    ['tsconfig*.json', 'tsconfig.json', true],
    ['tsconfig*.json', 'tsconfig.app.json', true],
    ['tsconfig*.json', 'packages/a/tsconfig.json', false],
    ['**/tsconfig*.json', 'packages/a/tsconfig.json', true],
    ['**/tsconfig*.json', 'tsconfig.json', true],
    ['eslint.config.*', 'eslint.config.mjs', true],
    ['eslint.config.*', 'eslint.config', false],
    ['.eslintrc.*', '.eslintrc.json', true],
    ['.eslintrc', '.eslintrcx', false],
    ['.github/workflows/**', '.github/workflows/ci.yml', true],
    ['.github/workflows/**', '.github/workflows/deep/x.yml', true],
    ['.github/workflows/**', '.github/ci.yml', false],
    ['**/*stratum*baseline*', 'tools/stratum.baseline.json', true],
    ['**/*stratum*baseline*', 'stratum-baseline.json', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/nested/a.ts', false],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/x/y/a.ts', true],
    ['src/**/*.ts', 'lib/a.ts', false],
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['file?.ts', 'file1.ts', true],
    ['file?.ts', 'file12.ts', false],
    ['file?.ts', 'file/.ts', false],
    ['**/*.{vue,tsx}', 'src/App.vue', true],
    ['**/*.{vue,tsx}', 'src/App.tsx', true],
    ['**/*.{vue,tsx}', 'src/App.ts', false],
    ['**/*.{test,spec}.{ts,js}', 'src/a.spec.js', true],
    ['**/*.{test,spec}.{ts,js}', 'a.test.ts', true],
    ['{src,lib/{a,b}}/x.ts', 'lib/b/x.ts', true],
    ['{src,lib/{a,b}}/x.ts', 'lib/c/x.ts', false],
    ['**/__tests__/**', '__tests__/a.ts', true],
    ['**/__tests__/**', 'src/__tests__/deep/a.ts', true],
    ['**/__tests__/**', 'src/tests/a.ts', false],
    ['v[0-9].md', 'v3.md', true],
    ['v[0-9].md', 'vx.md', false],
    ['v[!0-9].md', 'vx.md', true],
    ['v[!0-9].md', 'v3.md', false],
    ['v[!0-9].md', 'v/.md', false],
    ['[ab].ts', 'a.ts', true],
    ['a+b(c).ts', 'a+b(c).ts', true],
    ['a+b(c).ts', 'aab(c).ts', false],
    ['\\*.ts', '*.ts', true],
    ['\\*.ts', 'a.ts', false],
    ['[unclosed.ts', '[unclosed.ts', true],
  ])('%s against %s is %s', (glob, path, expected) => {
    expect(matchGlob(path, glob)).toBe(expected)
  })

  it('normalizes backslashes in the path', () => {
    expect(matchGlob('src\\a\\b.ts', 'src/**/*.ts')).toBe(true)
  })

  it('matches any glob of a list', () => {
    const matches = createMatcher(['*.md', 'docs/**'])
    expect([matches('README.md'), matches('docs/a/b.txt'), matches('src/a.ts')]).toEqual([true, true, false])
  })

  it('an empty list matches nothing', () => {
    expect(createMatcher([])('a.ts')).toBe(false)
  })
})
