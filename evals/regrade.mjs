import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { BASH, TRACE_CAP, cap, diffAgainstBase, git, gradeAll, lastMessage, loadCases, parseStream, removeDir, run, toolCallText, traceText, weightedScore } from './run-local.mjs'

const USAGE = `usage: node evals/regrade.mjs <results dir> <suite dir> [--case <name>] [--judge-model haiku] [--trust-replay]
Re-grades stored runs with the current graders, without re-running the agent. The project is rebuilt
in a temp dir from the case scaffold plus diffs/<run>.diff, or, for results stored without a diff, a
replay of the trace's Write/Edit/MultiEdit calls. A replay misses files the agent wrote from the shell,
so a run with such commands keeps its stored verdicts for graders that read the diff, unless
--trust-replay (after you checked those commands). Writes <results dir>/regraded/<run>.json.
`

const [resultsDir, suiteDir, ...rest] = process.argv.slice(2)
if (!resultsDir || !suiteDir) {
  process.stderr.write(USAGE)
  process.exit(2)
}
const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
const options = { judgeModel: flag('--judge-model') ?? 'haiku' }

const slash = (path) => path.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').toLowerCase()

const failedToolUses = (events) =>
  new Set(
    events
      .filter((event) => event.type === 'user')
      .flatMap((event) => (Array.isArray(event.message?.content) ? event.message.content : []))
      .filter((block) => block?.type === 'tool_result' && block.is_error)
      .map((block) => block.tool_use_id),
  )

const replayEdits = (events, oldRunDir, runDir) => {
  const failed = failedToolUses(events)
  const root = `${slash(oldRunDir)}/`
  const misses = []
  for (const event of events.filter((entry) => entry.type === 'assistant')) {
    for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
      if (block?.type !== 'tool_use' || failed.has(block.id) || !['Write', 'Edit', 'MultiEdit'].includes(block.name)) continue
      const filePath = String(block.input.file_path ?? '')
      if (!slash(filePath).startsWith(root)) continue
      const target = join(runDir, filePath.replace(/\\/g, '/').slice(root.length))
      if (block.name === 'Write') {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, block.input.content)
        continue
      }
      let text = existsSync(target) ? readFileSync(target, 'utf8') : undefined
      for (const edit of block.name === 'Edit' ? [block.input] : block.input.edits) {
        if (text === undefined || !text.includes(edit.old_string)) {
          misses.push(filePath)
          continue
        }
        text = edit.replace_all ? text.split(edit.old_string).join(edit.new_string) : text.replace(edit.old_string, () => edit.new_string)
      }
      if (text !== undefined) writeFileSync(target, text)
    }
  }
  return misses
}

const SHELL_WRITE = /[^-=2]>|<<|\bsed\s+-i|\bperl\s+-\w*i|\btee\b|\bpython\b|\bnode\s+-e\b|\b(?:mv|cp|rm)\s|\bgit\s+(?:apply|checkout|restore|stash|reset|mv|rm)\b|--fix\b|--write\b/

const shellWriteCount = (events) =>
  events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => (Array.isArray(event.message?.content) ? event.message.content : []))
    .filter((block) => block?.type === 'tool_use' && block.name === 'Bash')
    .map((block) => String(block.input.command).replace(/2>&1|>\s*\/dev\/null|>\s*ci-result\.(?:log|txt)/g, ''))
    .filter((command) => SHELL_WRITE.test(command)).length

const regrade = async (recordPath) => {
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  const id = basename(recordPath, '.json')
  const [testCase] = loadCases(resolve(suiteDir), record.case)
  const events = parseStream(readFileSync(join(resultsDir, 'traces', `${id}.jsonl`), 'utf8'))
  const runDir = mkdtempSync(join(tmpdir(), 'jig-regrade-'))
  try {
    if (testCase.scaffold) {
      const scaffold = await run(BASH, [testCase.scaffold.replace(/\\/g, '/')], { cwd: runDir, timeoutMs: 600_000 })
      if (scaffold.code !== 0) throw new Error(`scaffold failed: ${cap(scaffold.stderr, 500)}`)
    }
    const base = git(runDir, ['rev-parse', 'HEAD']).stdout.trim()
    const diffPath = resolve(resultsDir, 'diffs', `${id}.diff`)
    let source = 'stored diff'
    let diffRebuilt = true
    if (existsSync(diffPath)) git(runDir, ['apply', '--whitespace=nowarn', '--binary', diffPath])
    else {
      const misses = replayEdits(events, record.runDir, runDir)
      const shellWrites = shellWriteCount(events)
      diffRebuilt = misses.length === 0 && (shellWrites === 0 || rest.includes('--trust-replay'))
      source = `trace replay, ${misses.length} edits not applied, ${shellWrites} shell writes not replayed`
    }
    const context = { runDir, trace: cap(traceText(events), TRACE_CAP), toolCalls: toolCallText(events), lastMessage: lastMessage(events), diff: diffAgainstBase(runDir, base) }
    const fresh = await gradeAll(testCase, record.arm, context, options)
    const graders = fresh.map((verdict) => {
      const grader = testCase.graders.find((entry) => entry.name === verdict.name)
      const target = grader.type === 'llm' ? (grader.focus ?? 'files') : grader.target
      const stored = record.graders.find((entry) => entry.name === verdict.name)
      const readsDiff = target === 'files' || target?.source === 'files'
      const missing = target?.source === 'file' && !existsSync(join(runDir, target.path))
      if (!stored || !(missing || (readsDiff && !diffRebuilt))) return verdict
      return { ...stored, reason: `kept from the stored run (${missing ? `${target.path} not rebuilt` : 'diff not rebuilt'}): ${stored.reason}` }
    })
    const score = weightedScore(graders)
    const judgeCostUsd = graders.reduce((sum, verdict) => sum + verdict.costUsd, 0)
    writeFileSync(join(resultsDir, 'regraded', `${id}.json`), JSON.stringify({ case: record.case, arm: record.arm, run: record.run, source, before: record.score, score, judgeCostUsd, graders }, null, 2))
    const verdicts = graders.map((verdict) => `${verdict.name}:${verdict.passed ? 'PASS' : 'FAIL'}`).join(' ')
    process.stdout.write(`[${id}] score ${record.score.toFixed(2)} -> ${score.toFixed(2)} judge $${judgeCostUsd.toFixed(4)} (${source}) ${verdicts}\n`)
  } finally {
    removeDir(runDir)
  }
}

mkdirSync(join(resultsDir, 'regraded'), { recursive: true })
for (const file of readdirSync(join(resultsDir, 'runs')).filter((name) => name.endsWith('.json'))) {
  if (flag('--case') && !file.startsWith(`${flag('--case')}-`)) continue
  await regrade(join(resultsDir, 'runs', file))
}
