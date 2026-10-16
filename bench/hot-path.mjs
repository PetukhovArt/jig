import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const jigRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const jigBin = join(jigRoot, 'bin', 'jig.mjs')
const KB_PER_MB = 1024
const DEFAULT_RUNS = 200

const fail = (message) => {
  process.stderr.write(`hot-path: ${message}\n`)
  process.exit(2)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: 'string', default: String(DEFAULT_RUNS) }, file: { type: 'string' } },
})

const [rootArg] = positionals
if (rootArg === undefined) fail('usage: node bench/hot-path.mjs <project-root> [--runs 200] [--file <relative path>]')
if (!existsSync(jigBin)) fail(`${jigBin} is missing, run npm run build`)
const projectRoot = resolve(rootArg)
const runs = Number(values.runs)
if (!Number.isInteger(runs) || runs < 1) fail(`--runs must be a positive integer, got ${values.runs}`)

const firstSourceFile = () => {
  const listed = execFileSync('git', ['ls-files', 'src'], { cwd: projectRoot, encoding: 'utf8' })
  const file = listed.split('\n').find((path) => path.endsWith('.ts'))
  if (file === undefined) fail(`no .ts file under ${projectRoot}/src in git ls-files`)
  return file
}

const relativeFile = values.file ?? firstSourceFile()
const absoluteFile = join(projectRoot, relativeFile)
if (!existsSync(absoluteFile)) fail(`${absoluteFile} does not exist`)
const editedLine = readFileSync(absoluteFile, 'utf8').split(/\r?\n/).find((line) => line.trim() !== '') ?? ''

const workDir = mkdtempSync(join(tmpdir(), 'jig-hot-path-'))
const preloadPath = join(workDir, 'rss.mjs')
writeFileSync(
  preloadPath,
  [
    "import { writeFileSync } from 'node:fs'",
    "process.on('exit', () => writeFileSync(process.env.JIG_BENCH_RSS_FILE, String(process.resourceUsage().maxRSS)))",
    '',
  ].join('\n'),
)
const rssFile = join(workDir, 'rss.txt')
const sessionId = `jig-bench-${process.pid}-${Date.now()}`

const env = {
  ...process.env,
  CLAUDE_PROJECT_DIR: projectRoot,
  CLAUDE_PLUGIN_ROOT: jigRoot,
  JIG_BENCH_RSS_FILE: rssFile,
}

const baseInput = (hookEventName) => ({
  session_id: sessionId,
  transcript_path: join(workDir, 'transcript.jsonl'),
  cwd: projectRoot,
  permission_mode: 'default',
  hook_event_name: hookEventName,
})

const editInput = { file_path: absoluteFile, old_string: editedLine, new_string: `${editedLine}\n` }

const events = {
  'session-start': { ...baseInput('SessionStart'), source: 'startup' },
  'post-edit': { ...baseInput('PostToolUse'), tool_name: 'Edit', tool_input: editInput, tool_response: { filePath: absoluteFile } },
  'pre-edit': { ...baseInput('PreToolUse'), tool_name: 'Edit', tool_use_id: 'bench', tool_input: editInput },
}

const runHook = (name) =>
  new Promise((done, reject) => {
    rmSync(rssFile, { force: true })
    const started = performance.now()
    const child = spawn(process.execPath, ['--import', pathToFileURL(preloadPath).href, jigBin, 'hook', name], {
      cwd: projectRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const ms = performance.now() - started
      const rssKb = existsSync(rssFile) ? Number(readFileSync(rssFile, 'utf8')) : Number.NaN
      done({ ms, rssKb, code, stdout, stderr })
    })
    child.stdin.end(JSON.stringify(events[name]))
  })

const percentile = (sorted, quantile) => sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]

const measure = async (name) => {
  const results = []
  for (let index = 0; index < runs; index++) {
    results.push(await runHook(name))
  }
  return results
}

const journalTools = () => {
  const dir = join(projectRoot, '.jig', 'journal')
  if (!existsSync(dir)) return new Map()
  const counts = new Map()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.includes(sessionId)) continue
      try {
        const record = JSON.parse(line)
        if (record.session !== sessionId) continue
        const key = `${record.tool ?? 'unknown'}:${record.kind}${record.rule === undefined ? '' : `:${record.rule}`}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      } catch {
        continue
      }
    }
  }
  return counts
}

const report = (name, results) => {
  const times = results.map((result) => result.ms).sort((left, right) => left - right)
  const rss = results.map((result) => result.rssKb).filter((value) => Number.isFinite(value))
  const failures = results.filter((result) => result.code !== 0)
  const withOutput = results.filter((result) => result.stdout.trim() !== '').length
  const peak = rss.length === 0 ? 'n/a' : `${(Math.max(...rss) / KB_PER_MB).toFixed(1)} MB`
  const format = (ms) => `${ms.toFixed(0)} ms`
  process.stdout.write(
    `${name.padEnd(9)} runs ${results.length}  p50 ${format(percentile(times, 0.5))}  p95 ${format(percentile(times, 0.95))}  max ${format(times.at(-1))}  peak RSS ${peak}  output ${withOutput}  exit!=0 ${failures.length}\n`,
  )
  if (failures.length > 0) {
    process.stdout.write(`  first failure stderr: ${failures[0].stderr.trim().slice(0, 300)}\n`)
  }
}

const removeSession = () => {
  rmSync(join(projectRoot, '.jig', 'cache', 'sessions', `${sessionId}.json`), { force: true })
}

try {
  process.stdout.write(`jig hot path: ${projectRoot}\nfile: ${relativeFile}\nnode ${process.version}, ${process.platform}\n`)
  await runHook('session-start')
  const before = journalTools()
  const postEdit = await measure('post-edit')
  const afterPost = journalTools()
  const preEdit = await measure('pre-edit')
  const afterPre = journalTools()
  report('post-edit', postEdit)
  report('pre-edit', preEdit)
  const delta = (from, to) => [...to].map(([key, count]) => [key, count - (from.get(key) ?? 0)]).filter(([, count]) => count > 0)
  const describe = (entries) => (entries.length === 0 ? 'none' : entries.map(([key, count]) => `${key} x${count}`).join(', '))
  process.stdout.write(`fired post-edit: ${describe(delta(before, afterPost))}\n`)
  process.stdout.write(`fired pre-edit: ${describe(delta(afterPost, afterPre))}\n`)
} finally {
  removeSession()
  rmSync(workDir, { recursive: true, force: true })
}
