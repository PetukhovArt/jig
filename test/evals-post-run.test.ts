import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveCommand, runHiddenTests, runUiCheck, withApp, type EvalCase } from '../evals/run-local.mjs'

const slash = (path: string) => path.replace(/\\/g, '/')
const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' })

let root: string
let savedPath: string | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-post-run-'))
  savedPath = process.env.PATH
})

afterEach(() => {
  process.env.PATH = savedPath
  rmSync(root, { recursive: true, force: true })
})

const project = () => {
  const runDir = join(root, 'run')
  mkdirSync(join(runDir, 'src'), { recursive: true })
  writeFileSync(join(runDir, 'src', 'app.ts'), 'export const port = 1\n')
  git(runDir, 'init', '-q')
  git(runDir, 'config', 'core.autocrlf', 'false')
  git(runDir, 'add', '-A')
  git(runDir, 'commit', '-qm', 'base')
  return runDir
}

describe('hidden tests step', () => {
  it('runs the case tests in place of the agent file, then puts the agent file back', async () => {
    const runDir = project()
    writeFileSync(join(runDir, 'src', 'app.test.ts'), 'agent version\n')
    const caseDir = join(root, 'case')
    mkdirSync(join(caseDir, 'hidden-tests', 'src'), { recursive: true })
    writeFileSync(join(caseDir, 'hidden-tests', 'src', 'app.test.ts'), 'hidden version\n')
    const fakeVitest = join(root, 'fake-vitest.mjs')
    writeFileSync(
      fakeVitest,
      `import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const out = args.find((arg) => arg.startsWith('--outputFile=')).slice('--outputFile='.length)
const seen = readFileSync('src/app.test.ts', 'utf8').trim()
const filter = args[args.indexOf('-t') + 1]
writeFileSync(out, JSON.stringify({ testResults: [{ name: 'src/app.test.ts', status: 'passed', assertionResults: [{ fullName: seen + ' / ' + filter + ' / ' + args.includes('--maxWorkers=1'), status: 'passed' }] }] }))
`,
    )
    const testCase: EvalCase = { name: 'c', dir: caseDir, hiddenTests: { dir: join(caseDir, 'hidden-tests'), command: `node ${slash(fakeVitest)}`, filter: 'keeps a' } }

    const result = await runHiddenTests(testCase, runDir, root)

    expect(result.text.split('\n')).toEqual(['HIDDEN: PASS', '1 passed, 0 failed', 'PASS hidden version / keeps a / true'])
    expect(readFileSync(join(runDir, 'src', 'app.test.ts'), 'utf8')).toBe('agent version\n')
  })
})

describe('UI check step', () => {
  const fakeAgentView = (verdicts: string[]) => {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(root, 'verdicts.txt'), `${verdicts.join('\n')}\n`)
    const script = join(bin, 'agent-view')
    writeFileSync(
      script,
      `#!/usr/bin/env bash
echo "agent-view $*" >> "$FAKE_LOG"
if [ "$1 $2" = "act replay" ]; then
  n=$(( $(cat "$FAKE_STATE" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_STATE"
  line=$(sed -n "\${n}p" "$FAKE_VERDICTS"); echo "$line"
  case "$line" in DONE*) exit 0 ;; STALE*) exit 3 ;; *) exit 1 ;; esac
fi
if [ "$1" = "screenshot" ]; then
  shot="$FAKE_TMP/shot-$RANDOM.png"; printf 'png' > "$shot"; echo "$shot"
fi
`,
    )
    chmodSync(script, 0o755)
    process.env.PATH = `${bin}${delimiter}${savedPath}`
  }

  const uiCase = (runDir: string): EvalCase => {
    const caseDir = join(root, 'case')
    mkdirSync(join(caseDir, 'acts', 'flows'), { recursive: true })
    writeFileSync(join(caseDir, 'acts', 'flows', 'use-case.json'), '{}')
    writeFileSync(join(runDir, 'src', 'app.ts'), 'export const port = Number(process.env.PORT)\n')
    writeFileSync(join(caseDir, 'local.patch'), git(runDir, 'diff').stdout)
    git(runDir, 'checkout', '--', '.')
    const log = slash(join(root, 'log.txt'))
    const env = `FAKE_LOG=${log} FAKE_STATE=${slash(join(root, 'state.txt'))} FAKE_VERDICTS=${slash(join(root, 'verdicts.txt'))} FAKE_TMP=${slash(root)}`
    return {
      name: 'c',
      dir: caseDir,
      ui: {
        start: 'grep -q process.env "$JIG_RUN_DIR/src/app.ts" && echo "start $JIG_UI_REPLAY" >> "$FAKE_LOG"',
        stop: 'echo stop >> "$FAKE_LOG"',
        restore: 'echo restore >> "$FAKE_LOG"',
        reset: 'echo reset >> "$FAKE_LOG"',
        replay: 'use-case',
        final_steps: ['paired'],
        patch: 'local.patch',
        acts: ['acts/flows'],
        env,
      },
    }
  }

  it('retries an early failure once, keeps a final-check failure, then stops, restores and unpatches', async () => {
    fakeAgentView(['STALE: step open: step 1/2 click testid=x — not on screen within 10s', 'FAIL: step paired — steps ran, until expr not met after 10s'])
    const runDir = project()
    const testCase = uiCase(runDir)
    const outDir = join(root, 'out')
    const tempDir = join(root, 'tmp')
    mkdirSync(tempDir)

    const check = await runUiCheck(testCase, runDir, tempDir, outDir, 'c-with-1')

    expect(check.verdict).toBe('fail')
    expect(check.attempts.map((attempt) => attempt.outcome)).toEqual(['early', 'final'])
    expect(check.screenshots).toEqual(['ui/c-with-1/attempt-1.png', 'ui/c-with-1/attempt-2.png'])
    expect(existsSync(join(outDir, 'ui', 'c-with-1', 'attempt-2.png'))).toBe(true)
    expect(existsSync(join(tempDir, 'act', '.agent-view', 'scripts', 'flows', 'use-case.json'))).toBe(true)
    expect(
      readFileSync(join(root, 'log.txt'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.trim()),
    ).toEqual(['start use-case', 'agent-view act replay use-case', 'agent-view screenshot --scale 0.5', 'reset', 'agent-view act replay use-case', 'agent-view screenshot --scale 0.5', 'stop', 'restore'])
    expect(readFileSync(join(runDir, 'src', 'app.ts'), 'utf8')).toBe('export const port = 1\n')
  })

  it('gives no verdict when the app does not start, and still stops it', async () => {
    fakeAgentView(['DONE: replay use-case'])
    const runDir = project()
    const testCase = uiCase(runDir)
    testCase.ui = { ...testCase.ui!, start: 'exit 4' }

    const check = await runUiCheck(testCase, runDir, join(root, 'run-tmp'), join(root, 'out'), 'c-with-2')

    expect(check.verdict).toBe('inconclusive')
    expect(check.error).toContain('start failed (4)')
    expect(readFileSync(join(root, 'log.txt'), 'utf8').trim().split('\n')).toEqual(['stop', 'restore'])
  })

  it('keeps start and stop output, and puts patched files back byte for byte', async () => {
    fakeAgentView(['DONE: replay use-case'])
    const runDir = project()
    const testCase = uiCase(runDir)
    testCase.ui = { ...testCase.ui!, start: `${testCase.ui!.start} && echo logged in`, stop: 'echo fixture deleted' }
    writeFileSync(join(runDir, 'src', 'app.ts'), 'export const port = 1\r\n')

    const check = await runUiCheck(testCase, runDir, join(root, 'run-tmp'), join(root, 'out'), 'c-with-3')

    expect(check.verdict).toBe('pass')
    expect(check.start).toEqual({ exitCode: 0, output: 'logged in' })
    expect(check.stop).toEqual({ exitCode: 0, output: 'fixture deleted' })
    expect(readFileSync(join(runDir, 'src', 'app.ts'), 'utf8')).toBe('export const port = 1\r\n')
  })

  it('runs one app task at a time', async () => {
    const events: string[] = []
    const task = (name: string, ms: number) => async () => {
      events.push(`${name} start`)
      await new Promise((resolve) => setTimeout(resolve, ms))
      events.push(`${name} end`)
    }

    await Promise.all([withApp(task('a', 30)), withApp(task('b', 1)), withApp(async () => Promise.reject(new Error('x'))).catch(() => undefined), withApp(task('c', 1))])

    expect(events).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end'])
  })
})

describe('the claude command on Windows', () => {
  it('runs an npm .cmd shim through node and keeps a native claude.exe', () => {
    const shims = join(root, 'npm')
    mkdirSync(shims, { recursive: true })
    writeFileSync(join(shims, 'claude.cmd'), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n')
    expect(resolveCommand('claude', { PATH: shims }, 'win32')).toEqual([process.execPath, join(shims, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')])
    const native = join(root, 'native')
    mkdirSync(native, { recursive: true })
    writeFileSync(join(native, 'claude.exe'), '')
    expect(resolveCommand('claude', { PATH: [native, shims].join(';') }, 'win32')).toEqual([join(native, 'claude')])
    expect(resolveCommand('claude', { PATH: shims }, 'linux')).toEqual(['claude'])
  })
})
