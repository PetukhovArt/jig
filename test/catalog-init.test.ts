import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
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
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jig-catalog-')))
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
    ['Server/Controllers/StreamController.cs', 'csharp'],
    ['README.md', undefined],
  ])('knows the language of %s', (file, language) => {
    expect(languageFor(file)?.name).toBe(language)
  })

  it.each([
    ['src/a.test.ts', true],
    ['src/__tests__/helper.ts', true],
    ['src/__tests__/data.json', true],
    ['src/a.ts', false],
    ['web/e2eTests/login.ts', false],
    ['Api.Tests/Fakes.cs', true],
    ['TestsBackend/UnitTest1.cs', true],
    ['Tests.Unit/Fakes.cs', true],
    ['Api/OrderTests.cs', true],
    ['Api/StreamTest.cs', true],
    ['api/tests/Fakes.cs', true],
    ['api/spec/Fakes.cs', true],
    ['Api/Stream.cs', false],
    ['Api/Attestation.cs', false],
    ['Contest/Score.cs', false],
    ['Api/Testable.cs', false],
  ])('knows %s by its path: %s', (file, expected) => {
    expect(isTestFile(file)).toBe(expected)
  })

  it.each([
    ['web/e2eTests/login.ts', "test('logs in', () => {})\n", true],
    ['src/flows.ts', "describe.each([1, 2])('flow %i', () => {})\n", true],
    ['src/run.ts', 'export const test = (value) => value\ntest(1)\n', false],
    ['Api/Stream.cs', 'public class Stream\n{\n    [Fact]\n    public void Reads() { }\n}\n', true],
    ['Api/Stream.cs', 'var cases = all[Test];\n', false],
    ['src/App.vue', "it('renders', () => {})\n", false],
  ])('knows %s by its content', (file, source, expected) => {
    expect(isTestFile(file, () => source)).toBe(expected)
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

describe('jig init: a locally excluded marker and a global binary', () => {
  const originalPath = process.env['PATH']

  afterEach(() => {
    process.env['PATH'] = originalPath
  })

  it('reports stratum configured and asks nothing about slots the config has', () => {
    write('stratum.config.jsonc', '{}')
    write('.git/info/exclude', 'stratum.config.jsonc\n')
    write('.jig/config.jsonc', '{ "slots": { "worktreesDir": ".." } }')
    const binary = join(root, 'global-bin', process.platform === 'win32' ? 'stratum-lint.exe' : 'stratum-lint')
    write(relative(root, binary), '')
    process.env['PATH'] = dirname(binary)
    const report = buildInitReport(root, true)
    const stratum = report.discovery.found.find((item) => item.name === 'stratum')
    expect([stratum?.status, stratum?.markers, stratum?.bin]).toEqual(['ready', ['stratum.config.jsonc'], [binary]])
    expect(report.questions.join('\n')).not.toContain('slots.dev')
    expect(report.questions.join('\n')).toContain('stratum for module layers (configured)')
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

  it('recommends Edit deny rules only and accepts a block without Write rules', () => {
    const denyCheck = () => doctorChecks(root, root).find((check) => check.text.startsWith('deny:'))
    expect(denyCheck()?.block).not.toContain('Write(')
    const rules = ['.jig/config.jsonc', 'eslint.config.*', 'tsconfig*.json', '.oxlintrc.json', 'stratum.config.jsonc', '.github/workflows/**', '.gitlab-ci.yml', '.husky/**']
    write('.claude/settings.json', JSON.stringify({ permissions: { deny: rules.map((path) => `Edit(${path})`) } }))
    expect(denyCheck()?.status).toBe('ok')
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
