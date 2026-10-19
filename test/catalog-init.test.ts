import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catalogEntry, isTestFile, languageFor, outputParser, PROOF_NAMES, TOOL_NAMES } from '../src/catalog'
import { splitCommand } from '../src/core/command'
import { loadConfig, validateConfig, type CustomCheck } from '../src/core/config'
import { git } from '../src/core/git'
import { configDrift, configDriftLine, resolveTools } from '../src/core/plan'
import { doctorChecks } from '../src/doctor'
import { checkArgv, runCustomCheck } from '../src/gates/custom'
import { discover } from '../src/init/discover'
import { buildInitReport } from '../src/init/init'
import { groupByMarker, nearestMarker } from '../src/tools/tool'

let root: string

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const config = (value: unknown) => ({ ...validateConfig(value).config, files: ['.jig/config.jsonc'] })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-catalog-'))
  git(['init', '-q'], root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('catalog', () => {
  it('looks definitions up by the names the config uses', () => {
    expect(TOOL_NAMES).toEqual(['oxlint', 'tsc', 'eslint', 'stratum'])
    expect(PROOF_NAMES).toEqual(['agent-view'])
    expect(catalogEntry('tsc')?.binaries.map((binary) => binary.command)).toEqual(['tsc', 'vue-tsc'])
    expect(catalogEntry('agent-view')?.kind).toBe('proof')
    expect(catalogEntry('ruff')).toBeUndefined()
  })

  it.each([
    ['src/a.ts', 'javascript'],
    ['src/App.VUE', 'vue'],
    ['README.md', undefined],
  ])('knows the language of %s', (file, language) => {
    expect(languageFor(file)?.name).toBe(language)
  })

  it('knows test files from the language patterns', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true)
    expect(isTestFile('src/__tests__/helper.ts')).toBe(true)
    expect(isTestFile('src/a.ts')).toBe(false)
  })

  it('offers tool parsers as custom check formats', () => {
    const findings = outputParser('jsonl')?.('{"v":1,"rule":"r","severity":"error","file":"a.ts","line":2,"message":"m"}\n', root, root)
    expect(findings).toEqual([{ tool: 'stratum', rule: 'r', severity: 'error', file: 'a.ts', line: 2, message: 'm' }])
    expect(outputParser('exit')).toBeUndefined()
  })
})

describe('nearest marker in a monorepo', () => {
  beforeEach(() => {
    write('eslint.config.js', '')
    write('packages/web/eslint.config.js', '')
    write('packages/web/src/App.ts', '')
    write('packages/api/src/main.ts', '')
  })

  it('takes the marker closest to the file, then the root one', () => {
    expect(nearestMarker(root, 'packages/web/src/App.ts', ['eslint.config.js'])).toBe(join(root, 'packages', 'web', 'eslint.config.js'))
    expect(nearestMarker(root, 'packages/api/src/main.ts', ['eslint.config.js'])).toBe(join(root, 'eslint.config.js'))
    expect(nearestMarker(root, 'packages/api/src/main.ts', ['.oxlintrc.json'])).toBeUndefined()
  })

  it('groups files by their marker and lists files without one', () => {
    const { groups, skipped } = groupByMarker(root, ['packages/web/src/App.ts', 'packages/api/src/main.ts'], ['eslint.config.js'])
    expect(groups.map((group) => [group.marker, group.files])).toEqual([
      [join(root, 'packages', 'web', 'eslint.config.js'), ['packages/web/src/App.ts']],
      [join(root, 'eslint.config.js'), ['packages/api/src/main.ts']],
    ])
    expect(groupByMarker(root, ['packages/web/src/App.ts'], ['stratum.config.jsonc']).skipped).toEqual(['packages/web/src/App.ts'])
    expect(skipped).toEqual([])
  })

  it.runIf(process.platform === 'win32')('accepts Windows separators in the file path', () => {
    expect(nearestMarker(root, 'packages\\web\\src\\App.ts', ['eslint.config.js'])).toBe(join(root, 'packages', 'web', 'eslint.config.js'))
  })

  it('does not look above the project root', () => {
    write('packages/web/inner/eslint.config.js', '')
    expect(nearestMarker(resolve(root, 'packages', 'api'), 'src/main.ts', ['eslint.config.js'])).toBeUndefined()
  })
})

describe('discovery and drift', () => {
  beforeEach(() => {
    write('package.json', JSON.stringify({ devDependencies: { 'vue-tsc': '2', '@petukhovart/stratum-lint': '1', 'eslint-plugin-boundaries': '4' } }))
    write('tsconfig.json', '{}')
    write('packages/app/eslint.config.js', '')
    write('node_modules/eslint/eslint.config.js', '')
  })

  it('finds catalog entries by marker and package, skipping ignored folders', () => {
    write('.gitignore', 'node_modules/\n')
    const { found, packages } = discover(root)
    expect(found.map((item) => [item.name, item.status, item.markers])).toEqual([
      ['tsc', 'ready', ['tsconfig.json']],
      ['eslint', 'ready', ['packages/app/eslint.config.js']],
      ['stratum', 'needs-setup', []],
    ])
    expect(found.find((item) => item.name === 'tsc')?.command).toBe('vue-tsc')
    expect(found.find((item) => item.name === 'stratum')?.setup).toEqual(['stratum-lint init', 'stratum-lint baseline'])
    expect(packages).toContain('eslint-plugin-boundaries')
  })

  it('reports tools the project has and the config does not name', () => {
    expect(configDrift(root, config({ tools: { tsc: { command: 'vue-tsc' } } }), [])).toEqual(['found eslint, not in config'])
  })

  it('accepts false as a decision, not drift', () => {
    expect(configDrift(root, config({ tools: { tsc: {}, eslint: false } }), [])).toEqual([])
  })

  it('reports a tool that is on but not installed, and a broken config', () => {
    expect(configDrift(root, config({ tools: { tsc: {}, eslint: {} } }), ['eslint'])).toEqual(['eslint is on in config, its binary is not installed'])
    expect(configDrift(root, { ...config({}), error: '$.x: unknown key' }, [])).toEqual(['.jig config is invalid ($.x: unknown key)'])
  })

  it('stays silent without config when the catalog finds nothing, and asks for jig init when it does', () => {
    const empty = mkdtempSync(join(tmpdir(), 'jig-empty-'))
    try {
      expect(configDrift(empty, loadConfig(empty), [])).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
    const missing = loadConfig(root)
    const drift = configDrift(root, missing, [])
    expect(configDriftLine({ drift, config: missing })).toBe('jig: no .jig/config.jsonc, found tsc, eslint. Run jig init to settle the project config.')
  })

  it('resolves only named tools, under the binary the command names', () => {
    write('node_modules/vue-tsc/package.json', JSON.stringify({ name: 'vue-tsc', bin: { 'vue-tsc': 'bin.js' } }))
    write('node_modules/vue-tsc/bin.js', '')
    const { tools, unresolved } = resolveTools(root, config({ tools: { tsc: { command: 'vue-tsc --strict' }, oxlint: false } }))
    expect(Object.keys(tools)).toEqual(['vueTsc'])
    expect(tools['vueTsc']?.bin.slice(-2)).toEqual([join(root, 'node_modules', 'vue-tsc', 'bin.js'), '--strict'])
    expect(unresolved).toEqual([])
  })

  it('proposes an explicit config by names and keeps the current one on --update', () => {
    write('.jig/config.jsonc', '{ "tools": { "eslint": { "ignoreRules": ["boundaries/*"] } }, "slots": { "worktreesDir": ".." } }')
    const fresh = buildInitReport(root, false)
    expect(fresh.proposal['tools']).toEqual({ tsc: { command: 'vue-tsc' }, eslint: {} })
    expect(fresh.proposal['rules']).toEqual({ 'jig/comments': 'error' })
    expect(fresh.boundaries).toBe(true)
    expect(fresh.questions.join('\n')).toMatch(/stratum.*installed, no stratum\.config\.jsonc.*stratum-lint init.*boundaries\/\*/)
    const update = buildInitReport(root, true)
    expect(update.proposal['tools']).toEqual({ eslint: { ignoreRules: ['boundaries/*'] }, tsc: { command: 'vue-tsc' } })
    expect(update.proposal['slots']).toEqual({ worktreesDir: '..' })
    expect(update.drift).toContain('found tsc, not in config')
  })
})

describe('jig doctor', () => {
  it('suggests setting agent-view up when the project has no agent-view.config.json', () => {
    const texts = doctorChecks(root, root).map((check) => `${check.status} ${check.text}`)
    expect(texts).toContainEqual(expect.stringMatching(/^warn agent-view: no agent-view\.config\.json; .*agent-view init$/))
    write('agent-view.config.json', '{}')
    expect(doctorChecks(root, root).map((check) => check.text)).not.toContainEqual(expect.stringMatching(/no agent-view\.config\.json/))
  })
})

describe('custom checks from config', () => {
  const check = (overrides: Partial<CustomCheck>): CustomCheck => ({
    name: 'probe',
    files: ['**/*.ts'],
    on: 'stop',
    run: 'node check.mjs {files}',
    format: 'exit',
    level: 'error',
    ...overrides,
  })

  beforeEach(() => {
    write('check.mjs', "const bad = process.argv.slice(2).filter((f) => f.includes('bad'))\nif (bad.length) { console.error(`bad file: ${bad.join(' ')}`); process.exit(1) }\n")
  })

  it('expands {files} into one argument per file', () => {
    expect(checkArgv(root, check({}), ['a b.ts', 'c.ts']).slice(-3)).toEqual(['check.mjs', 'a b.ts', 'c.ts'])
    expect(splitCommand('"C:\\Program Files\\node.exe" x.mjs {files}')).toEqual(['C:\\Program Files\\node.exe', 'x.mjs', '{files}'])
  })

  it('turns a failing exit into one finding and a clean exit into none', async () => {
    const failed = await runCustomCheck(root, check({}), ['src/bad.ts'], 10_000)
    expect(failed.failure).toBeUndefined()
    expect(failed.findings).toEqual([{ tool: 'probe', rule: 'check/probe', severity: 'error', file: 'src/bad.ts', line: 1, message: 'bad file: src/bad.ts' }])
    expect((await runCustomCheck(root, check({}), ['src/good.ts'], 10_000)).findings).toEqual([])
    expect((await runCustomCheck(root, check({ level: 'warn' }), ['src/bad.ts'], 10_000)).findings.map((finding) => finding.severity)).toEqual(['warn'])
  })
})
