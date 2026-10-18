import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { transferLock } from '../src/core/proc'
import { groupByTsconfig, runTypeCheck, tsconfigHash, writeClosureConfig } from '../src/tools/tsc'

let root: string

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const slash = (path: string): string => path.replace(/\\/g, '/')

const tscBin = [process.execPath, createRequire(import.meta.url).resolve('typescript/bin/tsc')]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-tsc-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('tsc closure of the turn diff', () => {
  it('writes a config that extends the selected tsconfig and lists only the group files', () => {
    write('tsconfig.json', '{ "compilerOptions": { "strict": true }, "include": ["src"] }')
    write('src/a.ts', 'export const a = 1\n')
    write('src/b.ts', 'export const b = 2\n')
    const { groups } = groupByTsconfig(root, ['src/a.ts', 'README.md', 'src/types.d.ts'])
    expect(groups).toEqual([{ config: join(root, 'tsconfig.json'), files: ['src/a.ts'] }])
    const configPath = writeClosureConfig(root, groups[0]!)
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(slash(configPath)).toMatch(/\/\.jig\/cache\/tsc\/tsconfig\.[0-9a-f]{12}\.json$/)
    expect(config.extends).toBe(slash(join(root, 'tsconfig.json')))
    expect(config.files).toEqual([slash(join(root, 'src/a.ts'))])
    expect(config.include).toEqual([`${slash(root)}/*.d.ts`, `${slash(root)}/src/**/*.d.ts`])
    expect(config.compilerOptions).toMatchObject({ noEmit: true, incremental: true, composite: false })
  })

  it('picks the referenced config whose include covers the file in a solution-style tsconfig', () => {
    write('tsconfig.json', '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./web" }] }')
    write('tsconfig.node.json', '{ "include": ["scripts/**/*.ts"] }')
    write('web/tsconfig.json', '{ "include": ["src"] }')
    write('scripts/build.ts', 'export {}\n')
    write('src/orphan.ts', 'export {}\n')
    write('web/src/view.vue', '<template />\n')
    const files = ['scripts/build.ts', 'src/orphan.ts', 'web/src/view.vue']
    const grouping = groupByTsconfig(root, files)
    expect(grouping.groups).toEqual([
      { config: join(root, 'tsconfig.node.json'), files: ['scripts/build.ts'] },
      { config: join(root, 'web', 'tsconfig.json'), files: ['web/src/view.vue'] },
    ])
    expect(grouping.skipped).toEqual(['src/orphan.ts'])
  })

  it('detaches a check that outlives its timeout, which then writes the incremental cache and frees the lock it was handed', async () => {
    write('tsconfig.json', '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["src"] }')
    write('src/use.ts', "export const s: string = 'x'\n")
    const { groups } = groupByTsconfig(root, ['src/use.ts'])
    const lockPath = join(root, '.jig', 'cache', 'heavy.lock')
    write('.jig/cache/heavy.lock', JSON.stringify({ pid: process.pid, at: Date.now() }))
    const result = await runTypeCheck({ tsc: { bin: tscBin } }, root, groups[0]!, 1, lockPath)
    expect(result?.failure).toContain('detached')
    transferLock(lockPath, result!.detachedPid!)
    const deadline = Date.now() + 60_000
    while (existsSync(lockPath) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 200))
    }
    expect(existsSync(lockPath)).toBe(false)
    const buildInfo = join(root, '.jig', 'cache', 'tsc', `${tsconfigHash(groups[0]!.config)}.tsbuildinfo`)
    expect(existsSync(buildInfo)).toBe(true)
  }, 70_000)

  it('reports type errors of the group files only, not of the files they import', async () => {
    write('tsconfig.json', '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["src"] }')
    write('src/lib.ts', "export const n: number = 'not a number'\n")
    write('src/use.ts', "import { n } from './lib'\nexport const s: string = n\n")
    write('src/other.ts', "export const broken: number = 'x'\n")
    const { groups } = groupByTsconfig(root, ['src/use.ts'])
    const result = await runTypeCheck({ tsc: { bin: tscBin } }, root, groups[0]!, 60_000)
    expect(result?.failure).toBeUndefined()
    expect(result?.findings.map(({ tool, rule, file, line }) => `${tool} ${rule} ${file}:${line}`)).toEqual(['tsc TS2322 src/use.ts:2'])
  })
})
