import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash', 'Read', 'Glob', 'Grep', 'Agent']
const TRACE_CAP = 400_000
const JUDGE_INPUT_CAP = 80_000

const usage = (message) => {
  if (message) process.stderr.write(`${message}\n`)
  process.stderr.write(`usage: node evals/run-local.mjs --plugin <dir> [--eval-dir evals/agent] [--case <name>] [--runs N]
  [--arms with,without] [-j N] [--model <m>] [--effort <level>] [--judge-model haiku] [--out <dir>] [--keep-temp]
  [--stop-at-utilization 0.98]
`)
  process.exit(2)
}

const parseArgs = (argv) => {
  const options = { evalDir: 'evals/agent', concurrency: 1, judgeModel: 'haiku', keepTemp: false, stopAtUtilization: 0.98 }
  const take = (index) => {
    if (argv[index + 1] === undefined) usage(`missing value for ${argv[index]}`)
    return argv[index + 1]
  }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--plugin') options.plugin = take(index++)
    else if (flag === '--eval-dir') options.evalDir = take(index++)
    else if (flag === '--case') options.case = take(index++)
    else if (flag === '--runs') options.runs = Number(take(index++))
    else if (flag === '--arms') options.arms = take(index++).split(',').map((arm) => arm.trim()).filter(Boolean)
    else if (flag === '-j' || flag === '--concurrency') options.concurrency = Math.max(1, Number(take(index++)))
    else if (flag === '--model') options.model = take(index++)
    else if (flag === '--effort') options.effort = take(index++)
    else if (flag === '--judge-model') options.judgeModel = take(index++)
    else if (flag === '--out') options.out = take(index++)
    else if (flag === '--keep-temp') options.keepTemp = true
    else if (flag === '--stop-at-utilization') options.stopAtUtilization = Number(take(index++))
    else if (flag === '-h' || flag === '--help') usage()
    else usage(`unknown argument ${flag}`)
  }
  if (!options.plugin) usage('--plugin is required')
  options.plugin = resolve(options.plugin)
  for (const arm of options.arms ?? []) if (arm !== 'with' && arm !== 'without') usage(`unknown arm ${arm}`)
  return options
}

const parseScalar = (raw) => {
  const text = raw.trim()
  if (text === '') return ''
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'")
  if (text.startsWith('"') && text.endsWith('"')) return JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\'))
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    return inner === '' ? [] : inner.split(',').map(parseScalar)
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === 'true' || text === 'false') return text === 'true'
  if (text === 'null' || text === '~') return null
  return text
}

const parseYaml = (source) => {
  const root = {}
  let parentKey
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const match = /^(\s*)([\w.-]+):\s?(.*)$/.exec(line)
    if (!match) continue
    const [, indent, key, value] = match
    if (indent.length > 0 && parentKey !== undefined) {
      root[parentKey][key] = parseScalar(value)
    } else if (value.trim() === '') {
      root[key] = {}
      parentKey = key
    } else {
      root[key] = parseScalar(value)
      parentKey = undefined
    }
  }
  return root
}

const parseFrontMatter = (source) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source)
  if (!match) return { meta: {}, body: source.trim() }
  return { meta: parseYaml(match[1]), body: match[2].trim() }
}

const parseFlowSteps = (body, path) => {
  const fenced = /```(?:json)?\r?\n([\s\S]*?)```/.exec(body)
  let steps
  try {
    steps = JSON.parse(fenced ? fenced[1] : body)
  } catch (error) {
    throw new Error(`${path}: a flow grader body is a JSON array of {step, evidence, skip?}: ${error.message}`)
  }
  const isStep = (step) => typeof step?.step === 'string' && typeof step.evidence === 'string' && (step.skip === undefined || typeof step.skip === 'string')
  if (!Array.isArray(steps) || steps.length === 0 || !steps.every(isStep)) throw new Error(`${path}: a flow grader body is a JSON array of {step, evidence, skip?}`)
  return steps
}

const loadGraders = (graderDir) =>
  existsSync(graderDir)
    ? readdirSync(graderDir)
        .filter((file) => file.endsWith('.md'))
        .sort()
        .map((file) => {
          const { meta, body } = parseFrontMatter(readFileSync(join(graderDir, file), 'utf8'))
          const steps = meta.type === 'flow' ? parseFlowSteps(body, join(graderDir, file)) : undefined
          return { name: basename(file, '.md'), ...meta, criteria: meta.criteria ?? body, steps, weight: meta.weight ?? 1 }
        })
    : []

const loadCases = (suiteDir, filter) => {
  const names = readdirSync(suiteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(suiteDir, entry.name, 'prompt.md')))
    .map((entry) => entry.name)
    .filter((name) => filter === undefined || name === filter)
    .sort()
  return names.map((name) => {
    const dir = join(suiteDir, name)
    const caseYaml = existsSync(join(dir, 'case.yaml')) ? parseYaml(readFileSync(join(dir, 'case.yaml'), 'utf8')) : {}
    const prompt = parseFrontMatter(readFileSync(join(dir, 'prompt.md'), 'utf8'))
    const scaffold = caseYaml.context?.scaffold_script
    return {
      name: caseYaml.name ?? name,
      dir,
      prompt: prompt.body,
      runs: prompt.meta.runs ?? caseYaml.runs ?? 3,
      maxTurns: prompt.meta.max_turns ?? caseYaml.max_turns ?? 60,
      timeoutSeconds: prompt.meta.timeout_seconds ?? caseYaml.timeout_seconds ?? 1800,
      allowedTools: prompt.meta.allowed_tools ?? caseYaml.allowed_tools ?? [],
      scaffold: scaffold ? join(dir, scaffold) : undefined,
      graders: loadGraders(join(dir, 'graders')),
    }
  })
}

const findBash = () => {
  if (process.platform !== 'win32') return 'bash'
  const candidates = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]
    .filter(Boolean)
    .map((base) => join(base, 'Git', 'bin', 'bash.exe'))
  return candidates.find((path) => existsSync(path)) ?? 'bash'
}
const BASH = findBash()

const isolatedEnv = () => {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^CLAUDE/i.test(key) || /^ANTHROPIC_(MODEL|SMALL_FAST_MODEL|DEFAULT_)/i.test(key)) continue
    env[key] = value
  }
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  env.DISABLE_AUTOUPDATER = '1'
  return env
}

const ISOLATION_FLAGS = ['--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence']

const killTree = (child) => {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGKILL')
}

const run = (command, args, { cwd, input, timeoutMs, env = isolatedEnv(), onStdoutLine } = {}) =>
  new Promise((resolvePromise) => {
    const started = Date.now()
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let pending = ''
    let timedOut = false
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          killTree(child)
        }, timeoutMs)
      : undefined
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdout += text
      if (!onStdoutLine) return
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop()
      for (const line of lines) onStdoutLine(line)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      stderr += String(error)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (onStdoutLine && pending) onStdoutLine(pending)
      resolvePromise({ code, stdout, stderr, timedOut, durationMs: Date.now() - started })
    })
    child.stdin.end(input ?? '')
  })

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const unlinkToolchainLink = (dir) => {
  const link = join(dir, 'node_modules')
  if (!existsSync(link) || !lstatSync(link).isSymbolicLink()) return
  try {
    unlinkSync(link)
  } catch {
    rmdirSync(link)
  }
}

const removeDir = (dir) => {
  unlinkToolchainLink(dir)
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

const parseStream = (text) => {
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return events
}

const blockText = (block) => {
  if (typeof block === 'string') return block
  if (block?.type === 'text') return block.text
  if (block?.type === 'tool_use') return `[tool_use ${block.name}] ${JSON.stringify(block.input)}`
  return ''
}

const traceText = (events) =>
  events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => (Array.isArray(event.message?.content) ? event.message.content : []))
    .map(blockText)
    .filter(Boolean)
    .join('\n')

const toolCallText = (events) =>
  events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => (Array.isArray(event.message?.content) ? event.message.content : []))
    .filter((block) => block?.type === 'tool_use')
    .map((block) => `${block.name} ${JSON.stringify(block.input)}`)
    .join('\n')

const lastMessage = (events) => {
  const reply = events.findLast((event) => event.type === 'result')
  if (typeof reply?.result === 'string' && reply.result.trim() !== '') return reply.result
  const assistant = events.findLast(
    (event) => event.type === 'assistant' && !event.parent_tool_use_id && Array.isArray(event.message?.content) && event.message.content.some((block) => block.type === 'text'),
  )
  return assistant ? assistant.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n') : ''
}

const tokenTotal = (usage) =>
  ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((sum, key) => sum + (typeof usage?.[key] === 'number' ? usage[key] : 0), 0)

const MODEL_USAGE_KEYS = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens']
const modelUsageTotal = (modelUsage) => {
  if (typeof modelUsage !== 'object' || modelUsage === null) return undefined
  const total = Object.values(modelUsage).reduce((sum, entry) => sum + MODEL_USAGE_KEYS.reduce((inner, key) => inner + (typeof entry?.[key] === 'number' ? entry[key] : 0), 0), 0)
  return total > 0 ? total : undefined
}

const readTarget = (target, context) => {
  if (target === 'trace') return context.trace
  if (target === 'last_message' || target === 'final_message') return context.lastMessage
  if (target === 'files') return context.diff()
  if (target === 'tool_calls') return context.toolCalls
  if (typeof target !== 'object' || target === null) return undefined
  if (target.source === 'files') return context.diff(target.exclude)
  if (target.source === 'file') {
    const path = join(context.runDir, target.path)
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  }
  return readTarget(target.source, context)
}

const gradeRegex = (grader, context) => {
  const text = readTarget(grader.target, context)
  const match = grader.match ?? 'contains'
  if (text === undefined) return { passed: false, reason: `target missing: ${JSON.stringify(grader.target)}` }
  const found = new RegExp(grader.pattern, grader.flags ?? '').exec(text)
  const passed = match === 'not_contains' ? found === null : found !== null
  const reason = found ? `matched ${JSON.stringify(found[0].slice(0, 120))}` : 'no match'
  return { passed, reason: `${match}: ${reason}` }
}

const gradeFlow = (grader, context) => {
  const said = `${context.trace}\n${context.lastMessage}`
  const steps = grader.steps.map(({ step, evidence, skip }) => {
    const done = new RegExp(evidence, 'im').exec(context.toolCalls)
    if (done) return { step, passed: true, how: `done ${JSON.stringify(done[0].slice(0, 80))}` }
    const skipped = skip === undefined ? null : new RegExp(skip, 'im').exec(said)
    if (skipped) return { step, passed: true, how: `skipped ${JSON.stringify(skipped[0].slice(0, 80))}` }
    return { step, passed: false, how: skip === undefined ? 'not done (no skip allowed)' : 'neither done nor skipped' }
  })
  return { passed: steps.every((entry) => entry.passed), reason: steps.map((entry) => `${entry.step}: ${entry.how}`).join('; '), steps }
}

const cap = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}\n[... truncated ${text.length - limit} chars]` : text)

const judgePrompt = (grader, evidence, focusLabel) => `You are a strict grader for an AI coding agent's work. Judge ONLY by the evidence below.

Criteria:
${grader.criteria}

Evidence (${focusLabel}):
<evidence>
${evidence}
</evidence>

Answer with exactly PASS or FAIL on the first line, then one or two sentences of reasoning.`

const focusLabel = (focus) => {
  if (typeof focus === 'object') return `file ${focus.path}`
  return focus === 'files' ? 'git diff of the run vs the base commit, new files included' : 'final assistant message'
}

const gradeLlm = async (grader, context, options) => {
  const focus = grader.focus ?? 'files'
  const raw = readTarget(focus, context)
  const evidence = raw === undefined || raw === '' ? '(empty: nothing found)' : cap(raw, JUDGE_INPUT_CAP)
  const args = ['-p', '--model', options.judgeModel, '--output-format', 'json', '--max-turns', '1', '--tools', '', ...ISOLATION_FLAGS]
  const result = await run('claude', args, { cwd: tmpdir(), input: judgePrompt(grader, evidence, focusLabel(focus)), timeoutMs: 300_000 })
  let verdict
  try {
    verdict = JSON.parse(result.stdout)
  } catch {
    return { passed: false, reason: `judge failed: ${cap(result.stderr || result.stdout, 300)}`, costUsd: 0 }
  }
  const text = String(verdict.result ?? '').trim()
  const firstWord = /^[^A-Za-z]*([A-Za-z]+)/.exec(text)?.[1]?.toUpperCase()
  return { passed: firstWord === 'PASS', reason: cap(text, 600), costUsd: verdict.total_cost_usd ?? 0 }
}

const diffAgainstBase = (runDir, base) => (exclude = []) => {
  git(runDir, ['add', '-A'])
  const skipped = [exclude].flat().map((glob) => `:(exclude,glob)${glob}`)
  return git(runDir, ['diff', '--cached', base, '--', '.', ':(exclude)ci-result.log', ':(exclude)package-lock.json', ...skipped]).stdout
}

const allowedTools = (testCase) => {
  const fromCase = testCase.allowedTools.map((tool) => String(tool).replace(/\(.*\)$/, ''))
  return [...new Set([...DEFAULT_TOOLS, ...fromCase])]
}

const agentArgs = (testCase, arm, options) => {
  const tools = allowedTools(testCase)
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-turns',
    String(testCase.maxTurns),
    '--tools',
    tools.join(','),
    '--allowedTools',
    tools.map((tool) => (tool === 'Bash' ? 'Bash(*)' : tool)).join(','),
    '--permission-mode',
    'acceptEdits',
    '--permission-prompts',
    'none',
    ...ISOLATION_FLAGS,
  ]
  if (options.model) args.push('--model', options.model)
  if (options.effort) args.push('--effort', options.effort)
  if (arm === 'with') args.push('--plugin-dir', options.plugin)
  return args
}

const rateLimit = { utilization: 0 }

const trackUtilization = (line) => {
  if (!line.includes('rate_limit_event')) return
  try {
    const utilization = JSON.parse(line).rate_limit_info?.utilization
    if (typeof utilization === 'number') rateLimit.utilization = Math.max(rateLimit.utilization, utilization)
  } catch {
    return
  }
}

const gradeAll = async (testCase, arm, context, options) => {
  const verdicts = []
  for (const grader of testCase.graders) {
    if (grader.arm && grader.arm !== 'both' && grader.arm !== arm) continue
    let verdict
    try {
      if (grader.type === 'regex') verdict = gradeRegex(grader, context)
      else if (grader.type === 'llm') verdict = await gradeLlm(grader, context, options)
      else if (grader.type === 'flow') verdict = gradeFlow(grader, context)
      else verdict = { passed: false, reason: `unsupported grader type ${grader.type}` }
    } catch (error) {
      verdict = { passed: false, reason: `grader error: ${error.message}` }
    }
    const steps = verdict.steps ? { steps: verdict.steps.map(({ step, passed }) => ({ step, passed })) } : {}
    verdicts.push({ name: grader.name, type: grader.type, weight: grader.weight, passed: verdict.passed, reason: verdict.reason, costUsd: verdict.costUsd ?? 0, ...steps })
  }
  return verdicts
}

const weightedScore = (verdicts) => {
  const total = verdicts.reduce((sum, verdict) => sum + verdict.weight, 0)
  return total === 0 ? 0 : verdicts.reduce((sum, verdict) => sum + (verdict.passed ? verdict.weight : 0), 0) / total
}

const claimedPorts = new Set()

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })

const claimPort = async () => {
  for (;;) {
    const port = await freePort()
    if (claimedPorts.has(port)) continue
    claimedPorts.add(port)
    return port
  }
}

const AGENT_VIEW_CONFIG = 'agent-view.config.json'

const ownCdpPort = async (runDir) => {
  const configPath = join(runDir, AGENT_VIEW_CONFIG)
  if (!existsSync(configPath)) return undefined
  const port = await claimPort()
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  writeFileSync(configPath, `${JSON.stringify({ ...config, port }, null, 2)}\n`)
  git(runDir, ['add', AGENT_VIEW_CONFIG])
  git(runDir, ['-c', 'user.email=eval@jig', '-c', 'user.name=eval', 'commit', '-qm', `eval: CDP port ${port}`])
  return port
}

const runAgent = async (testCase, arm, index, options, outDir, runDir, tempDir, record) => {
  if (testCase.scaffold) {
    const scaffold = await run(BASH, [testCase.scaffold.replace(/\\/g, '/')], { cwd: runDir, timeoutMs: 600_000 })
    if (scaffold.code !== 0) throw new Error(`scaffold failed (${scaffold.code}): ${cap(scaffold.stderr, 1000)}`)
  }
  record.cdpPort = await ownCdpPort(runDir)
  const base = git(runDir, ['rev-parse', 'HEAD']).stdout.trim()
  const tracePath = join(outDir, 'traces', `${testCase.name}-${arm}-${index + 1}.jsonl`)
  const agent = await run('claude', agentArgs(testCase, arm, options), {
    cwd: runDir,
    env: { ...isolatedEnv(), TMPDIR: tempDir, TEMP: tempDir, TMP: tempDir },
    input: testCase.prompt,
    timeoutMs: testCase.timeoutSeconds * 1000,
    onStdoutLine: trackUtilization,
  })
  writeFileSync(tracePath, agent.stdout)
  const events = parseStream(agent.stdout)
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init')
  const results = events.filter((event) => event.type === 'result')
  const result = results.at(-1)
  const sum = (key) => (results.some((entry) => typeof entry[key] === 'number') ? results.reduce((total, entry) => total + (entry[key] ?? 0), 0) : undefined)
  Object.assign(record, {
    tracePath,
    model: init?.model,
    plugins: init?.plugins?.map((plugin) => plugin.name),
    exitCode: agent.code,
    timedOut: agent.timedOut,
    resultSubtype: result?.subtype,
    resultEvents: results.length,
    turns: sum('num_turns'),
    costUsd: result?.total_cost_usd,
    agentDurationMs: sum('duration_ms') ?? agent.durationMs,
    usage: result?.usage,
    modelUsage: result?.modelUsage,
    tokens: result ? (modelUsageTotal(result.modelUsage) ?? tokenTotal(result.usage)) : undefined,
  })
  if (!result) record.error = `no result event (exit ${agent.code}${agent.timedOut ? ', timed out' : ''}): ${cap(agent.stderr, 500)}`
  return { runDir, trace: cap(traceText(events), TRACE_CAP), toolCalls: toolCallText(events), lastMessage: lastMessage(events), diff: diffAgainstBase(runDir, base) }
}

const runOne = async ({ testCase, arm, index, options, outDir }) => {
  const runDir = mkdtempSync(join(tmpdir(), 'jig-eval-'))
  const tempDir = mkdtempSync(join(tmpdir(), 'jig-eval-tmp-'))
  const record = { case: testCase.name, arm, run: index + 1, runDir, tempDir, score: 0, graders: [] }
  const started = Date.now()
  try {
    const context = await runAgent(testCase, arm, index, options, outDir, runDir, tempDir, record)
    writeFileSync(join(outDir, 'diffs', `${testCase.name}-${arm}-${index + 1}.diff`), context.diff())
    record.graders = await gradeAll(testCase, arm, context, options)
    record.score = weightedScore(record.graders)
    record.judgeCostUsd = record.graders.reduce((sum, verdict) => sum + verdict.costUsd, 0)
  } catch (error) {
    record.error = error.message
  }
  record.durationMs = Date.now() - started
  if (options.keepTemp) record.keptDir = runDir
  else {
    try {
      removeDir(runDir)
      removeDir(tempDir)
    } catch (error) {
      record.cleanupError = error.message
    }
  }
  writeFileSync(join(outDir, 'runs', `${testCase.name}-${arm}-${index + 1}.json`), JSON.stringify(record, null, 2))
  const verdicts = record.graders.map((verdict) => `${verdict.name}:${verdict.passed ? 'PASS' : 'FAIL'}`).join(' ')
  const error = record.error ? ` ERROR ${record.error}` : ''
  process.stdout.write(`[${testCase.name}/${arm}/${index + 1}] score ${record.score.toFixed(2)} cost $${(record.costUsd ?? 0).toFixed(2)} turns ${record.turns ?? '-'} ${verdicts}${error}\n`)
  return record
}

const mean = (values) => (values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length)
const numbers = (runs, pick) => runs.map(pick).filter((value) => typeof value === 'number' && Number.isFinite(value))
const fmt = (value, digits, prefix = '') => (value === undefined ? 'n/a' : `${prefix}${value.toFixed(digits)}`)
const signed = (value, digits, unit = '') => (value === undefined ? 'n/a' : `${value >= 0 ? '+' : '-'}${unit}${Math.abs(value).toFixed(digits)}`)

const armStats = (runs) => ({
  count: runs.length,
  score: mean(runs.map((run) => run.score)),
  cost: mean(numbers(runs, (run) => run.costUsd)),
  tokens: mean(numbers(runs, (run) => run.tokens)),
  turns: mean(numbers(runs, (run) => run.turns)),
  errors: runs.filter((run) => run.error).length,
})

const runsOf = (records, name, arm) => records.filter((run) => run.case === name && run.arm === arm)

const summarize = (records, cases, arms) => {
  const table = ['| case | arm | runs | mean score | mean cost | mean tokens | mean turns | errors |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
  const deltas = ['| case | score with | score without | score delta | cost delta | tokens delta |', '| --- | --- | --- | --- | --- | --- |']
  const graders = ['| case | arm | grader | passed |', '| --- | --- | --- | --- |']
  for (const testCase of cases) {
    const stats = Object.fromEntries(arms.map((arm) => [arm, armStats(runsOf(records, testCase.name, arm))]))
    for (const arm of arms) {
      const s = stats[arm]
      table.push(`| ${testCase.name} | ${arm} | ${s.count} | ${fmt(s.score, 2)} | ${fmt(s.cost, 2, '$')} | ${fmt(s.tokens, 0)} | ${fmt(s.turns, 1)} | ${s.errors} |`)
      for (const grader of testCase.graders) {
        const runs = runsOf(records, testCase.name, arm)
        const passed = runs.filter((run) => run.graders.some((verdict) => verdict.name === grader.name && verdict.passed)).length
        graders.push(`| ${testCase.name} | ${arm} | ${grader.name} | ${passed}/${runs.length} |`)
        for (const { step } of grader.steps ?? []) {
          const stepPassed = runs.filter((run) => run.graders.some((verdict) => verdict.name === grader.name && verdict.steps?.some((entry) => entry.step === step && entry.passed))).length
          graders.push(`| ${testCase.name} | ${arm} | ${grader.name}: ${step} | ${stepPassed}/${runs.length} |`)
        }
      }
    }
    if (stats.with && stats.without) {
      const delta = (key) => (stats.with[key] === undefined || stats.without[key] === undefined ? undefined : stats.with[key] - stats.without[key])
      deltas.push(`| ${testCase.name} | ${fmt(stats.with.score, 2)} | ${fmt(stats.without.score, 2)} | ${signed(delta('score'), 2)} | ${signed(delta('cost'), 2, '$')} | ${signed(delta('tokens'), 0)} |`)
    }
  }
  const agentCost = records.reduce((sum, run) => sum + (run.costUsd ?? 0), 0)
  const judgeCost = records.reduce((sum, run) => sum + (run.judgeCostUsd ?? 0), 0)
  return [
    '## Per case and arm',
    '',
    ...table,
    '',
    ...(deltas.length > 2 ? ['## Delta with - without', '', ...deltas, ''] : []),
    '## Graders',
    '',
    ...graders,
    '',
    `Total cost: agent $${agentCost.toFixed(2)} + judge $${judgeCost.toFixed(2)} = $${(agentCost + judgeCost).toFixed(2)}`,
    '',
  ].join('\n')
}

const runPool = async (jobs, options) => {
  const records = []
  let next = 0
  let stopped = false
  const worker = async () => {
    while (next < jobs.length) {
      if (rateLimit.utilization >= options.stopAtUtilization) {
        if (!stopped) process.stdout.write(`rate limit utilization ${rateLimit.utilization} >= ${options.stopAtUtilization}: no more runs launched\n`)
        stopped = true
        return
      }
      const job = jobs[next++]
      records.push(await runOne(job))
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, jobs.length) }, worker))
  return { records, stopped }
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const suiteDir = isAbsolute(options.evalDir) ? options.evalDir : join(options.plugin, options.evalDir)
  if (!existsSync(suiteDir)) usage(`no eval dir ${suiteDir}`)
  const cases = loadCases(suiteDir, options.case)
  if (cases.length === 0) usage(`no cases in ${suiteDir}${options.case ? ` named ${options.case}` : ''}`)
  const arms = options.arms ?? (/agent-flow/.test(options.evalDir.replace(/\\/g, '/')) ? ['with'] : ['with', 'without'])
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = resolve(options.out ?? join(suiteDir, 'results', `local-${stamp}`))
  mkdirSync(join(outDir, 'runs'), { recursive: true })
  mkdirSync(join(outDir, 'traces'), { recursive: true })
  mkdirSync(join(outDir, 'diffs'), { recursive: true })

  const jobs = cases.flatMap((testCase) =>
    Array.from({ length: options.runs ?? testCase.runs }, (_, index) => arms.map((arm) => ({ testCase, arm, index, options, outDir }))).flat(),
  )
  process.stdout.write(`${jobs.length} runs, ${cases.length} cases, arms ${arms.join(',')}, -j ${options.concurrency}, bash ${BASH}\nout ${outDir}\n`)
  const { records, stopped } = await runPool(jobs, options)

  const aggregate = {
    runner: 'evals/run-local.mjs',
    plugin: options.plugin,
    evalDir: suiteDir,
    arms,
    partial: stopped,
    maxRateLimitUtilization: rateLimit.utilization,
    cases: cases.map((testCase) => ({
      name: testCase.name,
      arms: Object.fromEntries(arms.map((arm) => [arm, runsOf(records, testCase.name, arm).sort((a, b) => a.run - b.run)])),
    })),
  }
  writeFileSync(join(outDir, 'aggregate-result.json'), JSON.stringify(aggregate, null, 2))
  const partial = stopped ? '**Partial: stopped at the rate limit utilization ceiling.**\n\n' : ''
  const summary = `# Local eval: ${options.evalDir}\n\n${partial}${summarize(records, cases, arms)}`
  writeFileSync(join(outDir, 'summary.md'), summary)
  process.stdout.write(`\n${summary}\nwritten ${join(outDir, 'summary.md')}\n`)
}

export { BASH, TRACE_CAP, cap, diffAgainstBase, git, gradeAll, lastMessage, loadCases, parseStream, removeDir, run, toolCallText, traceText, weightedScore }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exit(1)
  })
