import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const KB_PER_MB = 1024
const US_PER_MS = 1000
const PERCENT = 100
const SAMPLE_INTERVAL_MS = 200

export const percentile = (sorted, quantile) => sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]

export const sortedNumbers = (values) => values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)

export const formatMs = (ms) => (Number.isFinite(ms) ? `${ms.toFixed(0)} ms` : 'n/a')

export const formatMb = (kb) => (Number.isFinite(kb) ? `${(kb / KB_PER_MB).toFixed(1)} MB` : 'n/a')

export const formatPercent = (value) => (Number.isFinite(value) ? `${value.toFixed(0)}%` : 'n/a')

export const createProbe = (workDir) => {
  const preloadPath = join(workDir, 'probe.mjs')
  const statsFile = join(workDir, 'probe.json')
  writeFileSync(
    preloadPath,
    [
      "import { writeFileSync } from 'node:fs'",
      'process.on(\'exit\', () => {',
      '  const usage = process.resourceUsage()',
      '  writeFileSync(process.env.JIG_BENCH_STATS_FILE, JSON.stringify({ rssKb: usage.maxRSS, cpuUs: usage.userCPUTime + usage.systemCPUTime }))',
      '})',
      '',
    ].join('\n'),
  )
  return { preloadPath, statsFile }
}

const readStats = (statsFile) => {
  try {
    const stats = JSON.parse(readFileSync(statsFile, 'utf8'))
    return { rssKb: stats.rssKb, cpuMs: stats.cpuUs / US_PER_MS }
  } catch {
    return { rssKb: Number.NaN, cpuMs: Number.NaN }
  }
}

export const runHook = ({ jigBin, probe, projectRoot, env, name, input }) =>
  new Promise((done, reject) => {
    rmSync(probe.statsFile, { force: true })
    const started = performance.now()
    const child = spawn(process.execPath, ['--import', pathToFileURL(probe.preloadPath).href, jigBin, 'hook', name], {
      cwd: projectRoot,
      env: { ...env, JIG_BENCH_STATS_FILE: probe.statsFile },
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
      const stats = existsSync(probe.statsFile) ? readStats(probe.statsFile) : { rssKb: Number.NaN, cpuMs: Number.NaN }
      done({ ms, ...stats, code, stdout, stderr })
    })
    child.stdin.end(JSON.stringify(input))
  })

const cpuTotals = () =>
  cpus().reduce(
    (sum, cpu) => {
      const total = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle
      return { busy: sum.busy + total - cpu.times.idle, total: sum.total + total }
    },
    { busy: 0, total: 0 },
  )

const loadBetween = (from, to) => {
  const total = to.total - from.total
  return total > 0 ? ((to.busy - from.busy) / total) * PERCENT : Number.NaN
}

export const startCpuSampler = () => {
  const first = cpuTotals()
  let previous = first
  let peak = Number.NaN
  const sample = () => {
    const current = cpuTotals()
    const load = loadBetween(previous, current)
    if (Number.isFinite(load)) {
      peak = Number.isFinite(peak) ? Math.max(peak, load) : load
    }
    previous = current
  }
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS)
  return () => {
    clearInterval(timer)
    sample()
    return { avg: loadBetween(first, previous), peak }
  }
}
