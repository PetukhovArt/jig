import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const CODE = /\.(ts|tsx|mts|cts|mjs|js|html|json)$/
const TEST = /^test\/.*\.test\.ts$/

const staged = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' })
  .stdout.split('\n')
  .filter(Boolean)

const node = (script, ...args) => [process.execPath, [join(root, script), ...args]]
const bin = (name) => join(root, 'node_modules', name)

const steps = [
  ['bundle and README blocks', ...node('scripts/build.mjs', '--check')],
  ['plugin version', ...node('scripts/sync-plugin-version.mjs', '--check')],
  ['skills, roles, atoms and doc links', ...node('bin/jig.mjs', 'build', '--check')],
]

const code = staged.filter((file) => CODE.test(file) && !file.startsWith('bin/'))
if (code.length > 0) {
  const buildInfo = join(root, 'node_modules', '.cache', 'jig-pre-commit.tsbuildinfo')
  mkdirSync(dirname(buildInfo), { recursive: true })
  steps.push(['types', process.execPath, [bin('typescript/bin/tsc'), '--noEmit', '--incremental', '--tsBuildInfoFile', buildInfo]])
  const sources = code.filter((file) => file.startsWith('src/') || TEST.test(file))
  const tests = sources.filter((file) => TEST.test(file))
  const related = sources.filter((file) => !TEST.test(file))
  if (related.length > 0) steps.push(['tests related to staged sources', process.execPath, [bin('vitest/vitest.mjs'), 'related', '--run', '--passWithNoTests', '--maxWorkers=2', ...related]])
  if (tests.length > 0) steps.push(['staged test files', process.execPath, [bin('vitest/vitest.mjs'), 'run', '--maxWorkers=2', ...tests]])
}

for (const [label, command, args] of steps) {
  if (!existsSync(args[0])) {
    process.stderr.write(`pre-commit: ${label}: ${args[0]} is missing, run npm ci\n`)
    process.exit(1)
  }
  const startedAt = Date.now()
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout}${result.stderr}\npre-commit: ${label} failed (${seconds} s)\n`)
    process.exit(1)
  }
  process.stdout.write(`pre-commit: ${label} ok (${seconds} s)\n`)
}
