import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createProbe, formatMb, formatMs, formatPercent, percentile, runHook, sortedNumbers, startCpuSampler } from './measure.mjs'

const jigRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const jigBin = join(jigRoot, 'bin', 'jig.mjs')
const DEFAULT_FILES = '1,5,20'
const DEFAULT_RUNS = 3
const TARGET_MS = 20_000
const LOCK_WAIT_MS = 120_000
const LOCK_POLL_MS = 250
const OUTPUT_PREVIEW = 160
const EXIT_INTERRUPTED = 130
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?tsx?$)|(?:^|\/)__tests__\//
const VUE_SCRIPT = /<script\b(?![^>]*\bsetup\b)[^>]*\blang=["']ts["'][^>]*>/

const fail = (message) => {
  process.stderr.write(`stop-gate: ${message}\n`)
  process.exit(2)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { files: { type: 'string', default: DEFAULT_FILES }, runs: { type: 'string', default: String(DEFAULT_RUNS) } },
})

const [rootArg] = positionals
if (rootArg === undefined) fail('usage: node bench/stop-gate.mjs <project-root> [--files 1,5,20] [--runs 3]')
if (!existsSync(jigBin)) fail(`${jigBin} is missing, run npm run build`)
const projectRoot = resolve(rootArg)
const runs = Number(values.runs)
if (!Number.isInteger(runs) || runs < 1) fail(`--runs must be a positive integer, got ${values.runs}`)
const fileCounts = values.files.split(',').map(Number)
if (fileCounts.some((count) => !Number.isInteger(count) || count < 1)) fail(`--files must list positive integers, got ${values.files}`)

const git = (args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' })

const appendTs = (content, name, value) => {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const body = content.endsWith('\n') ? content : `${content}${eol}`
  return `${body}export const ${name} = ${value}${eol}`
}

const insertVue = (content, name, value) => {
  const open = VUE_SCRIPT.exec(content)
  const close = content.indexOf('</script>', open.index)
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  return `${content.slice(0, close)}export const ${name} = ${value}${eol}${content.slice(close)}`
}

const isCandidate = (path) => {
  if (TEST_FILE.test(path) || path.endsWith('.d.ts') || path.includes('node_modules/')) return false
  if (path.endsWith('.ts')) return true
  return path.endsWith('.vue') && VUE_SCRIPT.test(readFileSync(join(projectRoot, path), 'utf8'))
}

const rank = (path) => (path.endsWith('.vue') ? 2 : 0) + (path.startsWith('src/') ? 0 : 1)

const pickFiles = (count) => {
  const listed = git(['ls-files', '--', '*.ts', '*.vue']).split('\n').filter((path) => path !== '')
  const candidates = listed.filter(isCandidate).sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
  if (candidates.length < count) fail(`--files asks for ${count} files, ${projectRoot} has ${candidates.length} tracked .ts/.vue source files`)
  const files = candidates.slice(0, count)
  const dirty = git(['status', '--porcelain', '--', ...files]).trim()
  if (dirty !== '') fail(`chosen files have uncommitted changes, commit or stash them first:\n${dirty}`)
  return files
}

const files = pickFiles(Math.max(...fileCounts))
const originals = new Map(files.map((path) => [path, readFileSync(join(projectRoot, path), 'utf8')]))
const restore = () => {
  for (const [path, content] of originals) {
    if (readFileSync(join(projectRoot, path), 'utf8') !== content) {
      writeFileSync(join(projectRoot, path), content)
    }
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'jig-stop-gate-'))
const probe = createProbe(workDir)
const sessionPrefix = `jig-bench-stop-${process.pid}-${Date.now()}`
const sessionsDir = join(projectRoot, '.jig', 'cache', 'sessions')
const heavyLock = join(projectRoot, '.jig', 'cache', 'heavy.lock')
const env = { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_PLUGIN_ROOT: jigRoot }

const cleanup = () => {
  restore()
  if (existsSync(sessionsDir)) {
    for (const name of readdirSync(sessionsDir).filter((entry) => entry.startsWith(sessionPrefix))) {
      rmSync(join(sessionsDir, name), { force: true })
    }
  }
  rmSync(workDir, { recursive: true, force: true })
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(EXIT_INTERRUPTED)
})

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitForHeavyLock = async () => {
  const deadline = Date.now() + LOCK_WAIT_MS
  while (existsSync(heavyLock) && Date.now() < deadline) {
    try {
      if (!isAlive(JSON.parse(readFileSync(heavyLock, 'utf8')).pid)) return
    } catch {
      return
    }
    await new Promise((done) => setTimeout(done, LOCK_POLL_MS))
  }
}

const journalKinds = (sessionId) => {
  const dir = join(projectRoot, '.jig', 'journal')
  if (!existsSync(dir)) return []
  const kinds = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.includes(sessionId)) continue
      try {
        const record = JSON.parse(line)
        if (record.session === sessionId && record.kind !== 'finding') kinds.push(`${record.tool ?? 'unknown'}:${record.kind}`)
      } catch {
        continue
      }
    }
  }
  return kinds
}

const verdictOf = (stdout) => {
  const text = stdout.trim()
  if (text === '') return { blocked: false, line: '' }
  try {
    const output = JSON.parse(text)
    const reason = output.reason ?? output.hookSpecificOutput?.additionalContext ?? text
    return { blocked: output.decision === 'block', line: String(reason).split('\n')[0] }
  } catch {
    return { blocked: false, line: text.split('\n')[0] }
  }
}

const turn = async (count, run) => {
  const sessionId = `${sessionPrefix}-${count}-${run}`
  const base = (hookEventName) => ({
    session_id: sessionId,
    transcript_path: join(workDir, 'transcript.jsonl'),
    cwd: projectRoot,
    permission_mode: 'default',
    hook_event_name: hookEventName,
  })
  const hook = (name, input) => runHook({ jigBin, probe, projectRoot, env, name, input })
  await waitForHeavyLock()
  try {
    await hook('session-start', { ...base('SessionStart'), source: 'startup' })
    await hook('user-prompt-submit', { ...base('UserPromptSubmit'), prompt_id: `${sessionId}-prompt`, prompt: 'bench turn' })
    let postEditMs = 0
    for (const [index, path] of files.slice(0, count).entries()) {
      const absolute = join(projectRoot, path)
      const original = originals.get(path)
      const name = `jigBenchStop${index}`
      const value = `'${sessionId}'`
      const changed = path.endsWith('.vue') ? insertVue(original, name, value) : appendTs(original, name, value)
      writeFileSync(absolute, changed)
      const editInput = { file_path: absolute, old_string: original, new_string: changed }
      const postEdit = await hook('post-edit', {
        ...base('PostToolUse'),
        tool_name: 'Edit',
        tool_input: editInput,
        tool_response: { filePath: absolute },
      })
      postEditMs += postEdit.ms
    }
    const stopSampler = startCpuSampler()
    const stop = await hook('stop', { ...base('Stop'), stop_hook_active: false, last_assistant_message: 'done' })
    const load = stopSampler()
    return { ...stop, load, postEditMs, ...verdictOf(stop.stdout), notes: journalKinds(sessionId) }
  } finally {
    restore()
  }
}

const summarize = (results) => {
  const times = sortedNumbers(results.map((result) => result.ms))
  const cpu = sortedNumbers(results.map((result) => result.cpuMs))
  const rss = sortedNumbers(results.map((result) => result.rssKb))
  const avg = results.reduce((sum, result) => sum + result.load.avg, 0) / results.length
  const peak = Math.max(...results.map((result) => result.load.peak).filter(Number.isFinite))
  return [
    `runs ${results.length}`,
    `p50 ${formatMs(percentile(times, 0.5))}`,
    `p95 ${formatMs(percentile(times, 0.95))}`,
    `max ${formatMs(times.at(-1))}`,
    `peak RSS ${formatMb(rss.at(-1))}`,
    `jig CPU p50 ${formatMs(percentile(cpu, 0.5))} p95 ${formatMs(percentile(cpu, 0.95))}`,
    `machine CPU avg ${formatPercent(avg)} peak ${formatPercent(peak)}`,
    `blocked ${results.filter((result) => result.blocked).length}`,
  ].join('  ')
}

const describe = (result) => {
  const line = result.line === '' ? 'no output' : result.line.slice(0, OUTPUT_PREVIEW)
  const notes = result.notes.length === 0 ? 'none' : [...new Set(result.notes)].join(', ')
  const exit = result.code === 0 ? '' : `  exit ${result.code}: ${result.stderr.trim().slice(0, OUTPUT_PREVIEW)}`
  return `${result.blocked ? 'blocked' : 'passed'}: ${line}  journal: ${notes}${exit}`
}

try {
  const cacheDir = join(projectRoot, '.jig', 'cache')
  const hasCache = existsSync(join(cacheDir, 'tsc')) || existsSync(join(cacheDir, 'eslint'))
  process.stdout.write(`jig stop gate: ${projectRoot}\nnode ${process.version}, ${process.platform}, ${cpus().length} CPUs\n`)
  process.stdout.write(`tsc/eslint caches before the first run: ${hasCache ? 'present' : 'absent (first run is cold)'}\n`)
  process.stdout.write(`target: stop < ${TARGET_MS / 1000} s; jig CPU and peak RSS are the jig process only, machine CPU includes tsc and eslint\n\n`)
  const verdicts = []
  for (const count of fileCounts) {
    const results = []
    for (let run = 0; run < runs; run++) {
      results.push(await turn(count, run))
    }
    const [first, ...rest] = results
    const worst = Math.max(...results.map((result) => result.ms))
    const isPass = worst < TARGET_MS
    verdicts.push(isPass)
    process.stdout.write(`${count} file${count === 1 ? '' : 's'}: ${files.slice(0, Math.min(count, 3)).join(', ')}${count > 3 ? ', ...' : ''}\n`)
    process.stdout.write(`  first  ${summarize([first])}  post-edit total ${formatMs(first.postEditMs)}\n`)
    if (rest.length > 0) {
      process.stdout.write(`  warm   ${summarize(rest)}  post-edit total p50 ${formatMs(percentile(sortedNumbers(rest.map((result) => result.postEditMs)), 0.5))}\n`)
    }
    process.stdout.write(`  first: ${describe(first)}\n`)
    if (rest.length > 0) process.stdout.write(`  last:  ${describe(rest.at(-1))}\n`)
    process.stdout.write(`  target < ${TARGET_MS / 1000} s on every run: ${isPass ? 'pass' : 'FAIL'} (max ${formatMs(worst)})\n\n`)
  }
  process.stdout.write(`overall: ${verdicts.every(Boolean) ? 'pass' : 'FAIL'}\n`)
} finally {
  cleanup()
}
