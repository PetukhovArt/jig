import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NA = 'н/д'
const AGGREGATE = 'aggregate-result.json'
const COLUMNS = ['без jig', 'jig без /jig', 'jig с /jig']

const usage = () => {
  process.stderr.write('usage: node evals/summarize.mjs <evals/agent/results/<ts>> <evals/agent-flow/results/<ts>>\n')
  process.exit(2)
}

const readAggregate = (path) => {
  const file = statSync(path).isDirectory() ? join(path, AGGREGATE) : path
  return JSON.parse(readFileSync(file, 'utf8'))
}

const casesByName = (aggregate) => new Map((aggregate?.cases ?? []).map((entry) => [entry.name, entry]))

const passedShare = (runs, grader) => {
  if (runs === undefined || runs.length === 0) return NA
  const passed = runs.filter((run) => run.graders?.some((result) => result.name === grader && result.passed === true))
  return `${passed.length}/${runs.length}`
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length

const meanOf = (runs, pick, format) => {
  const values = (runs ?? []).map(pick).filter((value) => typeof value === 'number' && Number.isFinite(value))
  return values.length === 0 ? NA : format(mean(values))
}

const tokenTotal = (record) => {
  const counts = [record.input_tokens, record.output_tokens, record.cache_read_input_tokens, record.cache_creation_input_tokens]
  return counts.reduce((sum, count) => sum + (typeof count === 'number' ? count : 0), 0)
}

const modelUsageTotal = (modelUsage) =>
  Object.values(modelUsage).reduce(
    (sum, entry) => sum + tokenTotal({ input_tokens: entry?.inputTokens, output_tokens: entry?.outputTokens, cache_read_input_tokens: entry?.cacheReadInputTokens, cache_creation_input_tokens: entry?.cacheCreationInputTokens }),
    0,
  )

const traceTokens = (run) => {
  if (typeof run.tracePath !== 'string' || run.tracePath === '' || !existsSync(run.tracePath)) return undefined
  let assistantTotal = 0
  let resultTotal
  for (const line of readFileSync(run.tracePath, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type === 'result' && typeof event.modelUsage === 'object' && event.modelUsage !== null) {
      resultTotal = modelUsageTotal(event.modelUsage)
    } else if (event?.type === 'result' && typeof event.usage === 'object' && event.usage !== null) {
      resultTotal = tokenTotal(event.usage)
    } else if (typeof event?.message?.usage === 'object' && event.message.usage !== null) {
      assistantTotal += tokenTotal(event.message.usage)
    }
  }
  const total = resultTotal ?? assistantTotal
  return total > 0 ? total : undefined
}

const METRICS = [
  ['CI: PASS', (runs) => passedShare(runs, 'ci')],
  ['proof', (runs) => passedShare(runs, 'proof')],
  ['cost', (runs) => meanOf(runs, (run) => run.costUsd, (value) => `$${value.toFixed(2)}`)],
  ['tokens', (runs) => meanOf(runs, traceTokens, (value) => String(Math.round(value)))],
  ['turns', (runs) => meanOf(runs, (run) => run.turns, (value) => value.toFixed(1))],
]

const row = (cells) => `| ${cells.join(' | ')} |`

const [agentPath, flowPath] = process.argv.slice(2)
if (agentPath === undefined) usage()

const agent = casesByName(readAggregate(agentPath))
const flow = flowPath === undefined ? new Map() : casesByName(readAggregate(flowPath))
const names = [...new Set([...agent.keys(), ...flow.keys()])]

const lines = [row(['case', 'metric', ...COLUMNS]), row(['---', '---', ...COLUMNS.map(() => '---')])]
for (const name of names) {
  const arms = [agent.get(name)?.arms?.without, agent.get(name)?.arms?.with, flow.get(name)?.arms?.with]
  for (const [metric, compute] of METRICS) {
    lines.push(row([name, metric, ...arms.map(compute)]))
  }
}
process.stdout.write(`${lines.join('\n')}\n`)
