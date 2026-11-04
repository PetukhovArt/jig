import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const SELF = 'scripts/hooks.mjs'
const CODE = /\.(ts|tsx|mts|cts|mjs|js|html|json)$/
const TEST = /^test\/.*\.test\.ts$/
const DOCS_ONLY = /^(\.changeset\/|docs\/|README\.md$)/
const SUBJECT = /^(feat|fix|docs|chore|refactor|test|perf|build|ci|style|revert)(\([^)]+\))?!?: \S/
const ZERO = /^0+$/

const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const lines = (text) => text.split('\n').map((line) => line.trimEnd()).filter(Boolean)
const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const privatePatterns = () => {
  const home = homedir()
  const patterns = [
    { label: 'local home path', regex: new RegExp(`${escape(home).replace(/\\\\/g, '[\\\\/]')}`, 'i') },
    { label: 'local home path', regex: new RegExp(`Users[\\\\/]${escape(userInfo().username)}\\b`, 'i') },
    { label: 'real merge request number (use !12)', regex: /(^|[^\w&])![0-9]{4,}\b/ },
  ]
  const file = process.env['JIG_PRIVATE_PATTERNS'] ?? join(home, '.jig', 'private-patterns')
  if (existsSync(file)) {
    for (const line of lines(readFileSync(file, 'utf8'))) {
      if (!line.startsWith('#')) patterns.push({ label: `pattern from ${file}`, regex: new RegExp(line, 'i') })
    }
  }
  return patterns
}

const privateHits = (where, text) => {
  const patterns = privatePatterns()
  return lines(text).flatMap((line) => {
    const labels = [...new Set(patterns.filter(({ regex }) => regex.test(line)).map(({ label }) => label))]
    return labels.length === 0 ? [] : [`${where}: ${labels.join(', ')}: ${line.trim().slice(0, 160)}`]
  })
}

const addedLinesByFile = (diff) => {
  const added = []
  let file = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.replace(/^\+\+\+ (b\/)?/, '')
    else if (line.startsWith('+') && file !== SELF) added.push([file, line.slice(1)])
  }
  return added
}

const scanDiff = (diff) => addedLinesByFile(diff).flatMap(([file, line]) => privateHits(file, line))

const bin = (name) => join(root, 'node_modules', name)
const node = (label, script, ...args) => ({ label, args: [join(root, script), ...args] })

const fastSteps = () => [
  node('bundle and README', 'scripts/build.mjs', '--check'),
  node('plugin version', 'scripts/sync-plugin-version.mjs', '--check'),
  node('skills, roles, atoms and doc links', 'bin/jig.mjs', 'build', '--check'),
]

const typesStep = () => {
  const buildInfo = join(root, 'node_modules', '.cache', 'jig-hooks.tsbuildinfo')
  mkdirSync(dirname(buildInfo), { recursive: true })
  return { label: 'types', args: [bin('typescript/bin/tsc'), '--noEmit', '--incremental', '--tsBuildInfoFile', buildInfo] }
}

const HOOK_GIT_ENV = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_QUARANTINE_PATH']
const checkEnv = () => {
  const env = { ...process.env }
  for (const name of HOOK_GIT_ENV) delete env[name]
  return env
}

const run = (steps) => {
  for (const { label, args } of steps) {
    if (!existsSync(args[0])) fail(`hooks: ${label}: ${args[0]} is missing, run npm ci`)
    const startedAt = Date.now()
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: checkEnv() })
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    if (result.status !== 0) fail(`${result.stdout}${result.stderr}\nhooks: ${label} failed (${seconds} s)`)
    process.stdout.write(`hooks: ${label} ok (${seconds} s)\n`)
  }
}

const preCommit = () => {
  const staged = lines(git('diff', '--cached', '--name-only', '--diff-filter=ACMR').stdout)
  const hits = scanDiff(git('diff', '--cached', '--unified=0', '--no-color').stdout)
  if (hits.length > 0) fail(`hooks: private details in staged lines (jig is public):\n${hits.join('\n')}`)
  const steps = fastSteps()
  const code = staged.filter((file) => CODE.test(file) && !file.startsWith('bin/'))
  if (code.length > 0) {
    steps.push(typesStep())
    const targets = code.filter((file) => file.startsWith('src/') || TEST.test(file))
    if (targets.length > 0) steps.push({ label: 'tests of the staged files', args: [bin('vitest/vitest.mjs'), 'related', '--run', '--passWithNoTests', '--maxWorkers=2', ...targets] })
  }
  run(steps)
}

const commitMsg = (file) => {
  const message = readFileSync(file, 'utf8').split('\n').filter((line) => !line.startsWith('#')).join('\n').trim()
  const subject = message.split('\n')[0] ?? ''
  if (/^(Merge|Revert|fixup!|squash!) /.test(subject)) return
  const problems = []
  if (!SUBJECT.test(subject)) problems.push(`subject is not "<type>(<scope>): <summary>" with type feat|fix|docs|chore|refactor|test|perf|build|ci|style|revert: ${subject}`)
  problems.push(...privateHits('commit message', message))
  const issues = [...message.matchAll(/^Fixes #(\d+)/gm)].map((match) => match[1])
  if (issues.length > 0) {
    const changesets = lines(git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', '.changeset/*.md').stdout)
      .filter((path) => !path.endsWith('README.md'))
      .map((path) => readFileSync(join(root, path), 'utf8'))
      .join('\n')
    for (const issue of issues) {
      if (!changesets.includes(`(#${issue})`)) problems.push(`the message names #${issue}: a staged changeset must end with (#${issue}) (docs/issues.md)`)
    }
  }
  if (problems.length > 0) fail(`hooks: commit message:\n${problems.join('\n')}`)
}

const ciOnMain = () => {
  if (spawnSync('gh', ['--version'], { encoding: 'utf8' }).status !== 0) return 'hooks: gh is not installed, CI on main not checked'
  const result = spawnSync('gh', ['run', 'list', '--workflow', 'ci.yml', '--branch', 'main', '--event', 'push', '--limit', '1', '--json', 'conclusion,status,databaseId,headSha'], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) return `hooks: gh run list failed, CI on main not checked: ${result.stderr.trim()}`
  const [latest] = JSON.parse(result.stdout || '[]')
  if (latest === undefined || latest.status !== 'completed' || latest.conclusion === 'success') return undefined
  if (process.env['JIG_PUSH_FIXES_CI'] === '1') return `hooks: CI on main is ${latest.conclusion}; pushing because JIG_PUSH_FIXES_CI=1`
  fail(
    [
      `hooks: CI on main is ${latest.conclusion} (run ${latest.databaseId}, ${latest.headSha.slice(0, 7)}). Fix it before pushing more work:`,
      `  gh run view ${latest.databaseId} --log-failed`,
      'When this push is the fix, push with JIG_PUSH_FIXES_CI=1.',
    ].join('\n'),
  )
}

const prePush = (input) => {
  const updates = lines(input).map((line) => line.split(' ')).filter(([, localSha]) => localSha !== undefined && !ZERO.test(localSha))
  if (updates.length === 0) return
  const changed = new Set()
  const hits = []
  let toMain = false
  for (const [, localSha, remoteRef, remoteSha] of updates) {
    if (remoteRef === 'refs/heads/main') toMain = true
    const base = remoteSha !== undefined && !ZERO.test(remoteSha) && git('cat-file', '-e', `${remoteSha}^{commit}`).status === 0 ? remoteSha : git('merge-base', localSha, 'origin/main').stdout.trim()
    const range = base === '' ? localSha : `${base}..${localSha}`
    for (const file of lines(git('diff', '--name-only', '--diff-filter=ACMR', base === '' ? `${localSha}^` : base, localSha).stdout)) changed.add(file)
    hits.push(...scanDiff(git('diff', '--unified=0', '--no-color', base === '' ? `${localSha}^` : base, localSha).stdout))
    hits.push(...privateHits(`messages of ${range}`, git('log', '--format=%B', range).stdout))
  }
  if (hits.length > 0) fail(`hooks: private details in the pushed commits (jig is public):\n${hits.join('\n')}`)
  if (toMain) {
    const note = ciOnMain()
    if (note !== undefined) process.stdout.write(`${note}\n`)
  }
  if (lines(git('status', '--porcelain', '--untracked-files=no').stdout).length > 0) process.stdout.write('hooks: the working tree has uncommitted changes; the checks run on it, not only on the pushed commits\n')
  const steps = fastSteps()
  if ([...changed].some((file) => !DOCS_ONLY.test(file))) {
    steps.push(typesStep())
    steps.push({ label: 'full test suite', args: [bin('vitest/vitest.mjs'), 'run', '--maxWorkers=2'] })
  }
  run(steps)
}

const [mode, arg] = process.argv.slice(2)
if (mode === 'pre-commit') preCommit()
else if (mode === 'commit-msg' && arg !== undefined) commitMsg(arg)
else if (mode === 'pre-push') prePush(readFileSync(0, 'utf8'))
else fail('usage: node scripts/hooks.mjs pre-commit | commit-msg <file> | pre-push < refs')
