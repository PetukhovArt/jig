import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { budgetCheck, classifyReplay, hiddenTestEvidence, replayVerdict } from './eval-steps.mjs'
import { unlinkModules } from './link-modules.mjs'

const DEFAULT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash', 'Read', 'Glob', 'Grep', 'Agent']
const TRACE_CAP = 400_000
const JUDGE_INPUT_CAP = 80_000
const EVALS_DIR = dirname(fileURLToPath(import.meta.url))

const usage = (message) => {
  if (message) process.stderr.write(`${message}\n`)
  process.stderr.write(`usage: node evals/run-local.mjs --plugin <dir> [--eval-dir evals/agent] [--case <name>] [--runs N]
  [--arms with,without] [-j N] [--model <m>] [--effort <level>] [--judge-model opus] [--judge-effort high]
  [--out <dir>] [--keep-temp] [--stop-at-utilization 0.98] [--max-usd <n>] [--no-ui]
`)
  process.exit(2)
}

const parseArgs = (argv) => {
  const options = { evalDir: 'evals/agent', concurrency: 1, judgeModel: 'opus', judgeEffort: 'high', keepTemp: false, stopAtUtilization: 0.98, ui: true }
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
    else if (flag === '--judge-effort') options.judgeEffort = take(index++)
    else if (flag === '--max-usd') options.maxUsd = Number(take(index++))
    else if (flag === '--no-ui') options.ui = false
    else if (flag === '--out') options.out = take(index++)
    else if (flag === '--keep-temp') options.keepTemp = true
    else if (flag === '--stop-at-utilization') options.stopAtUtilization = Number(take(index++))
    else if (flag === '-h' || flag === '--help') usage()
    else usage(`unknown argument ${flag}`)
  }
  if (!options.plugin) usage('--plugin is required')
  if (options.maxUsd !== undefined && !(options.maxUsd > 0)) usage('--max-usd takes a positive number')
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
      baseLink: caseYaml.context?.base_link,
      estimateUsd: caseYaml.estimate_usd,
      hiddenTests: caseYaml.hidden_tests && { ...caseYaml.hidden_tests, dir: join(dir, caseYaml.hidden_tests.dir ?? 'hidden-tests') },
      ui: caseYaml.ui_check,
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
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') stderr += String(error)
    })
    child.stdin.end(input ?? '')
  })

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const removeDir = (dir) => {
  unlinkModules(join(dir, 'node_modules'))
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

const scaffoldInto = async (testCase, dir) => {
  if (!testCase.scaffold) return
  const scaffold = await run(BASH, [testCase.scaffold.replace(/\\/g, '/')], { cwd: dir, env: { ...isolatedEnv(), JIG_EVALS_DIR: EVALS_DIR }, timeoutMs: 600_000 })
  if (scaffold.code !== 0) throw new Error(`scaffold failed (${scaffold.code}): ${cap(scaffold.stderr, 1000)}`)
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
  if (target === 'hidden_tests') return context.hiddenTests
  if (target === 'ui') return context.ui?.text
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
  if (focus === 'ui') return 'act replay of the use case in the app built from the run, screenshots after each attempt attached in order'
  return focus === 'files' ? 'git diff of the run vs the base commit, new files included' : 'final assistant message'
}

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

const judgeInput = (prompt, images) => {
  const pictures = images.map((path) => ({ type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[extname(path).toLowerCase()] ?? 'image/png', data: readFileSync(path).toString('base64') } }))
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }, ...pictures] } })}\n`
}

const gradeLlm = async (grader, context, options) => {
  const focus = grader.focus ?? 'files'
  if (focus === 'ui' && context.ui?.verdict !== 'pass' && context.ui?.verdict !== 'fail') {
    return { passed: false, skipped: true, reason: `no UI verdict to judge: ${context.ui ? `${context.ui.verdict}${context.ui.error ? `, ${context.ui.error}` : ''}` : 'the UI step did not run'}` }
  }
  const raw = readTarget(focus, context)
  const evidence = raw === undefined || raw === '' ? '(empty: nothing found)' : cap(raw, JUDGE_INPUT_CAP)
  const images = focus === 'ui' ? context.ui.screenshots.filter((path) => existsSync(path)) : []
  const args = ['-p', '--model', options.judgeModel, '--effort', options.judgeEffort, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--max-turns', '1', '--tools', '', ...ISOLATION_FLAGS]
  const result = await run('claude', args, { cwd: tmpdir(), input: judgeInput(judgePrompt(grader, evidence, focusLabel(focus)), images), timeoutMs: 300_000 })
  const verdict = parseStream(result.stdout).findLast((event) => event.type === 'result')
  if (!verdict) return { passed: false, reason: `judge failed: ${cap(result.stderr || result.stdout, 300)}`, costUsd: 0 }
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
    const skipped = verdict.skipped ? { skipped: true } : {}
    verdicts.push({ name: grader.name, type: grader.type, weight: grader.weight, passed: verdict.passed, reason: verdict.reason, costUsd: verdict.costUsd ?? 0, ...steps, ...skipped })
  }
  return verdicts
}

const weightedScore = (verdicts) => {
  const scored = verdicts.filter((verdict) => !verdict.skipped)
  const total = scored.reduce((sum, verdict) => sum + verdict.weight, 0)
  return total === 0 ? 0 : scored.reduce((sum, verdict) => sum + (verdict.passed ? verdict.weight : 0), 0) / total
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

const baseProjects = new Map()

const baseProjectOf = (testCase) => {
  if (!baseProjects.has(testCase.name)) {
    const dir = mkdtempSync(join(tmpdir(), 'jig-eval-base-'))
    baseProjects.set(testCase.name, { dir, ready: scaffoldInto(testCase, dir) })
  }
  const base = baseProjects.get(testCase.name)
  return base.ready.then(() => base.dir)
}

const runAgent = async (testCase, arm, index, options, outDir, runDir, tempDir, record) => {
  await scaffoldInto(testCase, runDir)
  if (testCase.baseLink) writeFileSync(join(runDir, testCase.baseLink), `${await baseProjectOf(testCase)}\n`)
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

const filesUnder = (dir, prefix = '') =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

const runHiddenTests = async (testCase, runDir, tempDir) => {
  const { dir, command = 'npx vitest run', filter } = testCase.hiddenTests
  const files = filesUnder(dir)
  const agentVersions = files.map((file) => [file, existsSync(join(runDir, file)) ? readFileSync(join(runDir, file)) : undefined])
  const reportPath = join(tempDir, 'hidden-tests.json')
  const [bin, ...args] = String(command).split(/\s+/).filter(Boolean)
  const fullArgs = [...args, ...files.filter((file) => TEST_FILE.test(file)), '--maxWorkers=1', ...(filter ? ['-t', String(filter)] : []), '--reporter=json', `--outputFile=${reportPath}`]
  try {
    for (const file of files) {
      mkdirSync(dirname(join(runDir, file)), { recursive: true })
      copyFileSync(join(dir, file), join(runDir, file))
    }
    const result = await run(bin, fullArgs, { cwd: runDir, env: { ...isolatedEnv(), TMPDIR: tempDir, TEMP: tempDir, TMP: tempDir }, timeoutMs: 600_000 })
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : undefined
    return { command: [bin, ...fullArgs.slice(0, -2)].join(' '), exitCode: result.code, ...hiddenTestEvidence(report, result) }
  } finally {
    for (const [file, content] of agentVersions) {
      if (content === undefined) rmSync(join(runDir, file), { force: true })
      else writeFileSync(join(runDir, file), content)
    }
  }
}

let appQueue = Promise.resolve()

const withApp = (task) => {
  const turn = appQueue.then(task, task)
  appQueue = turn.catch(() => undefined)
  return turn
}

const parseEnv = (text) => Object.fromEntries([...String(text ?? '').matchAll(/(\w+)=(?:"([^"]*)"|'([^']*)'|(\S*))/g)].map(([, key, double, single, bare]) => [key, double ?? single ?? bare]))

const copyActs = (testCase, actDir) => {
  const scripts = join(actDir, '.agent-view', 'scripts')
  const { store, store_sections: storeSections = [], acts = [] } = testCase.ui
  for (const section of storeSections) cpSync(join(store, section), join(scripts, section), { recursive: true })
  for (const section of acts) cpSync(join(testCase.dir, section), join(scripts, basename(section)), { recursive: true })
}

const uiEvidence = (check) =>
  [
    `use case ${check.replay}: ${check.verdict}${check.error ? ` (${check.error})` : ''}`,
    ...check.attempts.flatMap((attempt, index) => [`attempt ${index + 1}: ${attempt.outcome}, exit ${attempt.exitCode}, screenshot ${attempt.screenshot ?? 'none'}`, attempt.output]),
    'Only a failure at the final check is the app failing; an earlier failure was retried once.',
  ].join('\n')

const patchedFiles = (runDir, patch) =>
  git(runDir, ['apply', '--numstat', '-z', patch])
    .stdout.split('\0')
    .map((entry) => entry.split('\t')[2])
    .filter((file) => file !== undefined && file !== '')
    .map((file) => join(runDir, file))

const runUiCheck = async (testCase, runDir, tempDir, outDir, id) => {
  const ui = testCase.ui
  const shotsDir = join(outDir, 'ui', id)
  const actDir = join(tempDir, 'act')
  mkdirSync(shotsDir, { recursive: true })
  mkdirSync(actDir, { recursive: true })
  copyActs(testCase, actDir)
  const env = {
    ...isolatedEnv(),
    ...parseEnv(ui.env),
    JIG_RUN_DIR: runDir,
    JIG_ACT_DIR: actDir,
    JIG_CASE_DIR: testCase.dir,
    JIG_EVALS_DIR: EVALS_DIR,
    JIG_CDP_PORT: String(await claimPort()),
    JIG_DEV_PORT: String(await claimPort()),
    JIG_UI_REPLAY: ui.replay,
  }
  const shell = (command, { cwd = testCase.dir, timeoutMs = 600_000 } = {}) => run(BASH, ['-c', command], { cwd, env, timeoutMs })
  const check = { replay: ui.replay, cdpPort: Number(env.JIG_CDP_PORT), devPort: Number(env.JIG_DEV_PORT), attempts: [], verdict: 'inconclusive', screenshots: [] }
  const patch = ui.patch ? resolve(testCase.dir, ui.patch) : undefined
  let originals = []
  try {
    if (patch) {
      originals = patchedFiles(runDir, patch).map((path) => ({ path, content: existsSync(path) ? readFileSync(path) : undefined }))
      const applied = git(runDir, ['apply', '--ignore-whitespace', '--whitespace=nowarn', patch])
      if (applied.status !== 0) {
        originals = []
        throw new Error(`patch ${ui.patch} does not apply: ${cap(applied.stderr, 300)}`)
      }
    }
    const started = await shell(ui.start)
    check.start = { exitCode: started.code, output: cap(`${started.stdout}\n${started.stderr}`.trim(), 1000) }
    if (started.code !== 0) throw new Error(`start failed (${started.code}): ${cap(check.start.output, 500)}`)
    for (;;) {
      const replay = await shell('agent-view act replay "$JIG_UI_REPLAY"', { cwd: actDir, timeoutMs: (ui.replay_timeout_seconds ?? 900) * 1000 })
      const output = `${replay.stdout}\n${replay.stderr}`.trim()
      const attempt = { outcome: classifyReplay({ code: replay.code, output }, { useCase: ui.replay, finalSteps: ui.final_steps ?? [] }), exitCode: replay.code, output: cap(output, 2000) }
      const shot = await shell('agent-view screenshot --scale 0.5', { cwd: actDir, timeoutMs: 60_000 })
      const shotPath = /^(.*\.(?:png|jpe?g|webp))\s*$/im.exec(shot.stdout)?.[1]?.trim()
      if (shotPath && existsSync(shotPath)) {
        const saved = join(shotsDir, `attempt-${check.attempts.length + 1}${extname(shotPath)}`)
        copyFileSync(shotPath, saved)
        rmSync(shotPath, { force: true })
        attempt.screenshot = relative(outDir, saved).replace(/\\/g, '/')
      }
      check.attempts.push(attempt)
      check.verdict = replayVerdict(check.attempts.map((entry) => entry.outcome))
      if (check.verdict !== 'retry') break
      if (ui.reset) await shell(ui.reset, { cwd: actDir, timeoutMs: 120_000 })
    }
  } catch (error) {
    check.error = error.message
  } finally {
    if (ui.stop) {
      const stopped = await shell(ui.stop, { timeoutMs: 120_000 })
      check.stopExit = stopped.code
      check.stop = { exitCode: stopped.code, output: cap(`${stopped.stdout}\n${stopped.stderr}`.trim(), 1000) }
    }
    if (ui.restore) {
      const restored = await shell(ui.restore, { timeoutMs: 900_000 })
      check.restore = { exitCode: restored.code, output: cap(`${restored.stdout}\n${restored.stderr}`.trim(), 1000) }
      if (restored.code !== 0) process.stdout.write(`[${id}] STAND RESTORE FAILED (${restored.code}): ${cap(check.restore.output, 300)}\n`)
    }
    for (const { path, content } of originals) {
      if (content === undefined) rmSync(path, { force: true })
      else writeFileSync(path, content)
    }
  }
  check.screenshots = check.attempts.filter((attempt) => attempt.screenshot).map((attempt) => attempt.screenshot)
  check.text = uiEvidence(check)
  writeFileSync(join(shotsDir, 'ui-check.json'), JSON.stringify(check, null, 2))
  return check
}

const uiContext = (check, outDir) => check && { ...check, screenshots: check.screenshots.map((path) => resolve(outDir, path)) }

const runOne = async ({ testCase, arm, index, options, outDir }) => {
  const runDir = mkdtempSync(join(tmpdir(), 'jig-eval-'))
  const tempDir = mkdtempSync(join(tmpdir(), 'jig-eval-tmp-'))
  const record = { case: testCase.name, arm, run: index + 1, runDir, tempDir, score: 0, graders: [] }
  const started = Date.now()
  try {
    const context = await runAgent(testCase, arm, index, options, outDir, runDir, tempDir, record)
    const id = `${testCase.name}-${arm}-${index + 1}`
    writeFileSync(join(outDir, 'diffs', `${id}.diff`), context.diff())
    if (testCase.hiddenTests) {
      record.hiddenTests = await runHiddenTests(testCase, runDir, tempDir)
      context.hiddenTests = record.hiddenTests.text
    }
    if (testCase.ui && options.ui) {
      record.ui = await withApp(() => runUiCheck(testCase, runDir, tempDir, outDir, id))
      context.ui = uiContext(record.ui, outDir)
    }
    git(runDir, ['checkout', '-q', '--', '.'])
    git(runDir, ['clean', '-fdq'])
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
  const verdicts = record.graders.map((verdict) => `${verdict.name}:${verdict.skipped ? 'SKIP' : verdict.passed ? 'PASS' : 'FAIL'}`).join(' ')
  const error = record.error ? ` ERROR ${record.error}` : ''
  process.stdout.write(`[${testCase.name}/${arm}/${index + 1}] score ${record.score.toFixed(2)} cost $${runCost(record).toFixed(2)} turns ${record.turns ?? '-'} ${verdicts}${error}\n`)
  return record
}

const runCost = (record) => (record.costUsd ?? 0) + (record.judgeCostUsd ?? 0)

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
  let inFlight = 0
  let stopped
  const stop = (reason) => {
    if (!stopped) process.stdout.write(`${reason}: no more runs launched\n`)
    stopped ??= reason
  }
  const worker = async () => {
    while (next < jobs.length && !stopped) {
      if (rateLimit.utilization >= options.stopAtUtilization) return stop(`rate limit utilization ${rateLimit.utilization} >= ${options.stopAtUtilization}`)
      const job = jobs[next]
      const budget = budgetCheck({ maxUsd: options.maxUsd, finishedCosts: records.map(runCost), inFlight, estimateUsd: job.testCase.estimateUsd })
      if (!budget.allowed) {
        return stop(`budget $${options.maxUsd}: spent $${budget.spentUsd.toFixed(2)} + ${inFlight + 1} x $${budget.perRunUsd.toFixed(2)} per run would reach $${budget.projectedUsd.toFixed(2)}`)
      }
      next++
      inFlight++
      records.push(await runOne(job))
      inFlight--
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
  for (const { dir, ready } of baseProjects.values()) {
    await ready.catch(() => undefined)
    if (!options.keepTemp) removeDir(dir)
  }

  const aggregate = {
    runner: 'evals/run-local.mjs',
    plugin: options.plugin,
    evalDir: suiteDir,
    arms,
    partial: stopped !== undefined,
    stoppedBy: stopped,
    maxUsd: options.maxUsd,
    totalCostUsd: records.reduce((sum, record) => sum + runCost(record), 0),
    maxRateLimitUtilization: rateLimit.utilization,
    cases: cases.map((testCase) => ({
      name: testCase.name,
      arms: Object.fromEntries(arms.map((arm) => [arm, runsOf(records, testCase.name, arm).sort((a, b) => a.run - b.run)])),
    })),
  }
  writeFileSync(join(outDir, 'aggregate-result.json'), JSON.stringify(aggregate, null, 2))
  const partial = stopped ? `**Partial: ${stopped}.**\n\n` : ''
  const budget = options.maxUsd === undefined ? '' : `Budget: $${options.maxUsd.toFixed(2)}, spent $${aggregate.totalCostUsd.toFixed(2)}\n`
  const summary = `# Local eval: ${options.evalDir}\n\n${partial}${summarize(records, cases, arms)}${budget}`
  writeFileSync(join(outDir, 'summary.md'), summary)
  process.stdout.write(`\n${summary}\nwritten ${join(outDir, 'summary.md')}\n`)
}

export { BASH, TRACE_CAP, cap, diffAgainstBase, git, gradeAll, lastMessage, loadCases, parseStream, removeDir, run, runHiddenTests, runUiCheck, scaffoldInto, toolCallText, traceText, uiContext, weightedScore, withApp }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exit(1)
  })
