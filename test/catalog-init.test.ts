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
import { buildInitReport, formatInitReport, SCHEMA_URL } from '../src/init/init'
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

  it('finds catalog entries by marker and package, skipping ignored and fixture folders', () => {
    write('.gitignore', 'node_modules/\n')
    write('test/fixtures/lint/.oxlintrc.json', '{}')
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
    expect(configDrift(root, config({ tsc: { command: 'vue-tsc' } }), [])).toEqual(['found eslint, not in config'])
  })

  it('says UI proof is off when agent-view.config.json exists and the config does not name agent-view', () => {
    write('agent-view.config.json', '{}')
    expect(configDrift(root, config({ tsc: {}, eslint: {} }), [])).toEqual(['found agent-view, not in config: UI proof is off'])
  })

  it('accepts false as a decision, not drift', () => {
    expect(configDrift(root, config({ tsc: {}, eslint: false }), [])).toEqual([])
  })

  it('reports a tool that is on but not installed, and a broken config', () => {
    expect(configDrift(root, config({ tsc: {}, eslint: {} }), ['eslint'])).toEqual(['eslint is on in config, its binary is not installed'])
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
    expect(configDriftLine({ drift, config: missing })).toBe('jig: no .jig/config.jsonc, so nothing runs; found tsc, eslint. Run jig init to settle the project config.')
  })

  it('resolves only named tools, under the binary the command names', () => {
    write('node_modules/vue-tsc/package.json', JSON.stringify({ name: 'vue-tsc', bin: { 'vue-tsc': 'bin.js' } }))
    write('node_modules/vue-tsc/bin.js', '')
    const { tools, unresolved } = resolveTools(root, config({ tsc: { command: 'vue-tsc --strict' }, oxlint: false }))
    expect(Object.keys(tools)).toEqual(['vueTsc'])
    expect(tools['vueTsc']?.bin.slice(-2)).toEqual([join(root, 'node_modules', 'vue-tsc', 'bin.js'), '--strict'])
    expect(unresolved).toEqual([])
  })

  it('proposes an explicit config by names and keeps the current one on --update', () => {
    write('.jig/config.jsonc', '{ "eslint": { "ignoreRules": ["boundaries/*"] }, "slots": { "worktreesDir": ".." } }')
    const fresh = buildInitReport(root, false)
    expect(fresh.proposal).toEqual({ $schema: SCHEMA_URL, tsc: { command: 'vue-tsc' }, eslint: {} })
    expect(fresh.boundaries).toBe(true)
    expect(fresh.questions.join('\n')).toMatch(/stratum.*installed, no stratum\.config\.jsonc.*stratum-lint init.*boundaries\/\*/)
    const update = buildInitReport(root, true)
    expect(update.proposal).toEqual({
      $schema: SCHEMA_URL,
      eslint: { ignoreRules: ['boundaries/*'] },
      slots: { worktreesDir: '..' },
      tsc: { command: 'vue-tsc' },
    })
    expect(update.drift).toContain('found tsc, not in config')
  })
})

describe('jig init: the project type-check script', () => {
  const manifest = (scripts: Record<string, string>): void =>
    write('package.json', JSON.stringify({ scripts, devDependencies: { typescript: '5' } }))

  beforeEach(() => {
    write('tsconfig.json', '{}')
    write('src/a.ts', '')
    write('src/view.vue', '')
    write('src/env.d.ts', '')
  })

  it('proposes "tsc": false and a stop check running the ts-decl-check script on the typed files', () => {
    manifest({ lint: 'eslint .', 'check:types': 'node tools/ts-decl-check.mjs --unchecked-ok' })
    const report = buildInitReport(root, false)
    const check = { name: 'types', files: ['**/*.ts', '**/*.vue'], on: 'stop', run: 'node tools/ts-decl-check.mjs --unchecked-ok {files}' }
    expect(report.proposal).toEqual({ $schema: SCHEMA_URL, tsc: false, checks: [check] })
    expect(validateConfig(report.proposal).errors).toEqual([])
    expect(checkArgv(root, check, ['src/a.ts']).slice(-3)).toEqual(['tools/ts-decl-check.mjs', '--unchecked-ok', 'src/a.ts'])
    expect(report.questions.join('\n')).not.toMatch(/--unchecked-ok/)
    manifest({ typecheck: 'ts-decl-check' })
    expect(buildInitReport(root, false).questions.join('\n')).toMatch(/add --unchecked-ok to script "typecheck"/)
  })

  it('reports, never proposes, a type-check script that takes no file list or needs a shell', () => {
    manifest({ typecheck: 'vue-tsc --noEmit' })
    const plain = buildInitReport(root, false)
    expect(plain.proposal['tsc']).toEqual({})
    expect(plain.proposal['checks']).toBeUndefined()
    expect(formatInitReport(plain)).toContain('type check: script "typecheck" (vue-tsc --noEmit) is not proposed as a check: it takes no file list')
    manifest({ typecheck: 'node ts-decl-check.mjs && echo ok' })
    expect(buildInitReport(root, false).discovery.typeCheck.script).toMatchObject({ takesFiles: false, reason: expect.stringMatching(/shell/) })
  })

  it('keeps a configured tsc and an existing types check on --update', () => {
    manifest({ typecheck: 'node ts-decl-check.mjs' })
    write('.jig/config.jsonc', '{ "tsc": {}, "checks": [{ "name": "types", "files": "**/*.ts", "on": "edit", "run": "x {files}" }] }')
    const update = buildInitReport(root, true)
    expect(update.proposal['tsc']).toEqual({})
    expect(update.proposal['checks']).toEqual([{ name: 'types', files: '**/*.ts', on: 'edit', run: 'x {files}' }])
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
