const mean = (values) => (values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length)

const budgetCheck = ({ maxUsd, finishedCosts, inFlight = 0, estimateUsd }) => {
  const spentUsd = finishedCosts.reduce((sum, cost) => sum + cost, 0)
  const perRunUsd = mean(finishedCosts) ?? estimateUsd ?? 0
  const projectedUsd = spentUsd + perRunUsd * (inFlight + 1)
  return { allowed: maxUsd === undefined || projectedUsd <= maxUsd, spentUsd, perRunUsd, projectedUsd }
}

const verdictLine = (output) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^(DONE|FAIL|STALE)\b/.test(line))

const classifyReplay = ({ code, output }, { useCase, finalSteps = [] }) => {
  const line = verdictLine(output)
  if (code === 0 && line?.startsWith('DONE')) return 'done'
  const verdict = ['FAIL: ', 'STALE: '].find((prefix) => line?.startsWith(prefix))
  if (verdict === undefined) return 'early'
  const where = line.slice(verdict.length)
  const startsWithName = (prefix) => where.startsWith(`${prefix} `) || where.startsWith(`${prefix}:`)
  if (startsWithName(`replay ${useCase}`)) return 'final'
  return finalSteps.some((step) => startsWithName(`step ${step}`)) ? 'final' : 'early'
}

const replayVerdict = (outcomes) => {
  const last = outcomes.at(-1)
  if (last === 'done') return 'pass'
  if (last === 'final') return 'fail'
  return outcomes.length < 2 ? 'retry' : 'inconclusive'
}

const firstLine = (text) => String(text ?? '').split('\n').find((line) => line.trim() !== '')?.trim() ?? ''

const hiddenTestEvidence = (report, { stderr = '' } = {}) => {
  const files = report?.testResults ?? []
  const tests = files.flatMap((file) =>
    (file.assertionResults ?? [])
      .filter((test) => test.status === 'passed' || test.status === 'failed')
      .map((test) => ({ name: test.fullName ?? test.title, passed: test.status === 'passed', message: firstLine(test.failureMessages?.[0]) })),
  )
  const brokenFiles = files.filter((file) => file.status === 'failed' && !(file.assertionResults ?? []).some((test) => test.status === 'failed'))
  const failed = tests.filter((test) => !test.passed)
  const passed = report !== undefined && tests.length > 0 && failed.length === 0 && brokenFiles.length === 0
  const lines = [
    `HIDDEN: ${passed ? 'PASS' : 'FAIL'}`,
    report === undefined ? `vitest wrote no report: ${firstLine(stderr) || 'no output'}` : `${tests.length - failed.length} passed, ${failed.length} failed`,
    ...tests.map((test) => `${test.passed ? 'PASS' : 'FAIL'} ${test.name}${test.message ? `: ${test.message}` : ''}`),
    ...brokenFiles.map((file) => `FILE FAILED ${file.name}: ${firstLine(file.message)}`),
  ]
  return { passed, tests, text: lines.join('\n') }
}

export { budgetCheck, classifyReplay, hiddenTestEvidence, mean, replayVerdict }
