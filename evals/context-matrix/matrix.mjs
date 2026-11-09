import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const NPM_CODEX_JS = process.env.APPDATA === undefined ? undefined : join(process.env.APPDATA, 'npm/node_modules/@openai/codex/bin/codex.js')
const CODEX_JS = process.env.JIG_MATRIX_CODEX_JS ?? (NPM_CODEX_JS !== undefined && existsSync(NPM_CODEX_JS) ? NPM_CODEX_JS : undefined)
const GROK = process.env.JIG_MATRIX_GROK ?? (existsSync(join(homedir(), '.grok/bin/grok.exe')) ? join(homedir(), '.grok/bin/grok.exe') : 'grok')

const HARNESSES = {
  claude: (task, cwd) => ({ command: 'claude', args: ['-p', task, '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'], cwd }),
  codex: (task, cwd) => {
    const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--skip-git-repo-check', '--json', task]
    return CODEX_JS === undefined ? { command: 'codex', args, cwd } : { command: process.execPath, args: [CODEX_JS, ...args], cwd }
  },
  grok: (task, cwd) => ({ command: GROK, args: ['-p', task, '--always-approve', '--trust', '--no-auto-update', '--output-format', 'streaming-json', '--cwd', cwd], cwd }),
}

const LAYOUTS = ['main', 'worktree', 'worktree-session', 'subagent']
const RUN_MS = 8 * 60_000
const FIELD = /^\s*(\w+)\??\s*:\s*boolean/gm
const EXPECTED_FIELD = 'enabled'

const usage = () => {
  process.stderr.write(`usage: node evals/context-matrix/matrix.mjs [--harness claude,codex,grok] [--layout ${LAYOUTS.join(',')}] [--root <dir>] [--out <file.json>]\n`)
  process.exit(2)
}

const parseArgs = (argv) => {
  const options = { harnesses: Object.keys(HARNESSES), layouts: LAYOUTS, root: join(homedir(), '.jig-context-matrix') }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index + 1]
    if (value === undefined) usage()
    if (argv[index] === '--harness') options.harnesses = value.split(',')
    else if (argv[index] === '--layout') options.layouts = value.split(',')
    else if (argv[index] === '--root') options.root = value
    else if (argv[index] === '--out') options.out = value
    else usage()
    index++
  }
  if (options.harnesses.some((name) => !(name in HARNESSES)) || options.layouts.some((name) => !LAYOUTS.includes(name))) usage()
  return options
}

const run = (command, args, cwd, timeoutMs = 60_000, env = process.env) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })

const git = async (args, cwd) => {
  const result = await run('git', args, cwd)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.output}`)
}

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const tokens = () => Object.fromEntries(['root', 'mid', 'leaf'].map((level) => [level, `${level.toUpperCase()}-${randomBytes(4).toString('hex')}`]))

const rule = (token) => {
  const name = `POLICY_${token.split('-')[0]}`
  return `Every file you create or edit here must export the constant \`${name}\`, exactly \`export const ${name} = '${token}'\`. This is mandatory.\n`
}

const buildFixture = async (base, marks) => {
  const repo = join(base, 'repo')
  rmSync(base, { recursive: true, force: true })
  write(join(repo, 'AGENTS.md'), `# Fixture project\n\nTypeScript sources live in \`src/\`.\n\n${rule(marks.root)}`)
  write(join(repo, 'src/a/AGENTS.md'), `# Module a\n\n${rule(marks.mid)}`)
  write(join(repo, 'src/a/CLAUDE.md'), '@AGENTS.md\n')
  write(join(repo, 'src/a/GLOSSARY.md'), '# Module a\n\n## Language\n\n**enabled**\nWhether the operator can interact with a widget at runtime.\n_Avoid_: disabled, clickable, interactive, active\n')
  write(join(repo, 'src/a/b/AGENTS.md'), `# Module a/b\n\n${rule(marks.leaf)}`)
  write(join(repo, 'src/a/b/tab.ts'), 'export interface Tab {\n  id: string\n  title: string\n}\n')
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['add', '-A'], repo)
  await git(['-c', 'user.name=matrix', '-c', 'user.email=matrix@example.invalid', 'commit', '-q', '-m', 'fixture'], repo)
  const worktree = join(base, 'repo-worktrees', 'task')
  await git(['worktree', 'add', '-q', '-b', 'task', worktree], repo)
  return { repo, worktree }
}

const TASK = (file) => `In ${file}, add to the \`Tab\` interface one boolean field that says whether the operator can click the tab. Change nothing else in the logic. Do not commit.`
const DELEGATE = 'Delegate the task below to a subagent and do not edit any file yourself; wait for it and report its result.\n\n'

const setup = (layout, { repo, worktree }) => {
  const file = (root) => join(root, 'src/a/b/tab.ts')
  switch (layout) {
    case 'main':
      return { cwd: repo, target: file(repo), task: TASK('src/a/b/tab.ts') }
    case 'worktree':
      return { cwd: repo, target: file(worktree), task: TASK(file(worktree)) }
    case 'worktree-session':
      return { cwd: worktree, target: file(worktree), task: TASK('src/a/b/tab.ts') }
    case 'subagent':
      return { cwd: repo, target: file(worktree), task: DELEGATE + TASK(file(worktree)) }
  }
}

const judge = (target, marks) => {
  const text = existsSync(target) ? readFileSync(target, 'utf8') : ''
  const fields = [...text.matchAll(FIELD)].map((match) => match[1])
  return {
    edited: text.includes('boolean'),
    root: text.includes(marks.root),
    mid: text.includes(marks.mid),
    leaf: text.includes(marks.leaf),
    field: fields[0] ?? null,
    glossary: fields[0] === EXPECTED_FIELD,
  }
}

const mark = (ok) => (ok ? 'yes' : '-')

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const results = []
  for (const harness of options.harnesses) {
    for (const layout of options.layouts) {
      const marks = tokens()
      const base = join(options.root, `${harness}-${layout}`)
      const fixture = await buildFixture(base, marks)
      const { cwd, target, task } = setup(layout, fixture)
      const spec = HARNESSES[harness](task, cwd)
      const started = Date.now()
      const result = await run(spec.command, spec.args, spec.cwd, RUN_MS, { ...process.env, JIG_HOOK_LOG: join(base, 'hooks.log') })
      writeFileSync(join(base, 'transcript.log'), result.output)
      const verdict = { harness, layout, exit: result.code, seconds: Math.round((Date.now() - started) / 1000), ...judge(target, marks) }
      results.push(verdict)
      process.stdout.write(
        `${harness.padEnd(7)} ${layout.padEnd(17)} edited=${mark(verdict.edited)} root=${mark(verdict.root)} mid=${mark(verdict.mid)} leaf=${mark(verdict.leaf)} field=${verdict.field ?? '-'} exit=${verdict.exit} ${verdict.seconds}s\n`,
      )
    }
  }
  if (options.out !== undefined) writeFileSync(options.out, `${JSON.stringify(results, null, 2)}\n`)
  const misses = results.filter((result) => !(result.edited && result.root && result.mid && result.leaf))
  process.stdout.write(`${results.length - misses.length}/${results.length} runs got the whole chain\n`)
  process.exitCode = misses.length === 0 ? 0 : 1
}

await main()
