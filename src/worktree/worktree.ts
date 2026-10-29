import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { loadConfig, type LoadedConfig } from '../core/config'
import { gitToplevel } from '../core/git'
import { resolveProjectRoot, toSlash } from '../core/paths'
import { formatDeps, formatPrune, provideDeps, prunePool, saveDeps } from './deps-pool'
import { listWorktrees, samePath } from './list'
import { removeLinkedWorktree } from './remove'
import { formatSeed, seedWorktree } from './seed'
import {
  auditWorktrees,
  currentWorktree,
  formatRow,
  KEPT_BUCKETS,
  matchItems,
  openMrBranches,
  removeWorktree,
  type SweepRow,
} from './sweep'

type Command = (args: string[]) => number | Promise<number>

export type Confirm = (question: string) => Promise<boolean>

const fail = (message: string, code: number): number => {
  process.stderr.write(`jig: ${message}\n`)
  return code
}

const print = (text: string): void => {
  process.stdout.write(`${text}\n`)
}

const mainCheckout = (cwd: string): string => {
  const main = listWorktrees(cwd)[0]?.path
  if (main === undefined) throw new Error(`no git worktrees found from ${toSlash(cwd)}`)
  return main
}

interface Target {
  dir: string
  main: string
  config: LoadedConfig
}

const checkoutTarget = (positionals: readonly string[], usage: string): Target | number => {
  const [target] = positionals
  if (positionals.length !== 1 || target === undefined) return fail(`usage: ${usage}`, 2)
  const dir = resolve(target)
  if (!existsSync(dir)) return fail(`no such dir ${toSlash(dir)}`, 1)
  const toplevel = gitToplevel(dir)
  if (toplevel === undefined || !samePath(toplevel, dir)) return fail(`${toSlash(dir)} is not the root of a git worktree`, 1)
  const main = mainCheckout(dir)
  const config = loadConfig(main)
  if (config.error !== undefined) return fail(`.jig/config.jsonc: ${config.error}`, 1)
  return { dir, main, config }
}

const worktreeSeed = (args: string[]): number => {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true, strict: true })
  const target = checkoutTarget(positionals, 'worktree seed <dir>')
  if (typeof target === 'number') return target
  if (samePath(target.main, target.dir)) return fail(`${toSlash(target.dir)} is the main checkout, seed fills another worktree from it`, 1)
  const items = seedWorktree(target.main, target.dir, target.config.worktree)
  for (const line of formatSeed(items)) {
    print(line)
  }
  return items.some((item) => item.action === 'failed') ? 1 : 0
}

const DEPS_USAGE = 'worktree deps <dir> [--save [--force]] | worktree deps --prune [--dry-run]'

const worktreeDeps = (args: string[]): number => {
  const { values, positionals } = parseArgs({
    args,
    options: { save: { type: 'boolean' }, force: { type: 'boolean' }, prune: { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  })
  const isSave = values.save === true
  if (values.prune === true) {
    if (positionals.length > 0 || isSave || values.force === true) return fail(`usage: ${DEPS_USAGE}`, 2)
    const pruned = prunePool(mainCheckout(process.cwd()), values['dry-run'] === true)
    formatPrune(pruned).forEach((line) => print(line))
    return pruned.kind === 'failed' ? 1 : 0
  }
  if (values['dry-run'] === true || (values.force === true && !isSave)) return fail(`usage: ${DEPS_USAGE}`, 2)
  const target = checkoutTarget(positionals, DEPS_USAGE)
  if (typeof target === 'number') return target
  const { dir, main, config } = target
  const install = config.slots?.install
  const outcome = isSave
    ? saveDeps(dir, { main, install, force: values.force })
    : provideDeps(dir, { main, install, after: config.worktree?.depsPool?.after })
  formatDeps(outcome).forEach((line) => print(line))
  return outcome.kind === 'failed' ? 1 : 0
}

const worktreeRemove = (args: string[]): number => {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true, strict: true })
  const [target] = positionals
  if (positionals.length !== 1 || target === undefined) return fail('usage: worktree remove <dir>', 2)
  const dir = resolve(target)
  const worktrees = listWorktrees(existsSync(dir) ? dir : process.cwd())
  const main = worktrees[0]?.path
  if (main === undefined) return fail(`no git worktrees found from ${toSlash(dir)}`, 1)
  if (samePath(main, dir)) return fail(`${toSlash(dir)} is the main checkout, remove takes a linked worktree`, 1)
  if (!worktrees.some((worktree) => samePath(worktree.path, dir))) return fail(`${toSlash(dir)} is not a worktree of ${toSlash(main)}`, 1)
  const removal = removeLinkedWorktree(dir, main)
  if (removal.error !== undefined) return fail(`could not remove ${toSlash(dir)}: ${removal.error}`, 1)
  print(`removed ${toSlash(dir)} (${removal.unlinked} links unlinked first)`)
  return 0
}

const terminalConfirm =(): Confirm | undefined => {
  if (process.stdin.isTTY !== true) return undefined
  return async (question) => {
    const prompt = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim())
    } finally {
      prompt.close()
    }
  }
}

const removeRows = (rows: readonly SweepRow[], mainRoot: string): number => {
  let code = 0
  for (const row of rows) {
    if (KEPT_BUCKETS.has(row.bucket)) {
      code = fail(`kept ${row.path}: ${row.bucket}`, 1)
      continue
    }
    const error = removeWorktree(row, mainRoot)
    if (error === undefined) {
      print(`removed ${row.path}`)
    } else {
      code = fail(`git could not remove ${row.path}: ${error}`, 1)
    }
  }
  return code
}

/**
 * `worktree sweep` reports every worktree but the main checkout by bucket and deletes nothing unless
 * each deletion is confirmed: per item at an interactive prompt (`--ask`) or named by `--yes`.
 */
export const worktreeSweep = async (args: string[], confirm: Confirm | undefined = terminalConfirm()): Promise<number> => {
  const { values } = parseArgs({
    args,
    options: { json: { type: 'boolean' }, ask: { type: 'boolean' }, yes: { type: 'string', multiple: true } },
    strict: true,
  })
  const projectRoot = resolveProjectRoot(process.cwd())
  const worktrees = listWorktrees(projectRoot)
  const mainRoot = worktrees[0]?.path ?? projectRoot
  const rows = auditWorktrees(worktrees, {
    mainRoot,
    repo: basename(mainRoot),
    current: currentWorktree(process.cwd()),
    openBranches: openMrBranches(projectRoot),
    now: Date.now(),
  })
  if (values.json === true) {
    print(JSON.stringify(rows, null, 2))
  } else {
    rows.forEach((row) => print(formatRow(row)))
  }
  const named = matchItems(rows, values.yes ?? [], process.cwd())
  if (named.unknown.length > 0) return fail(`not a worktree of this repo: ${named.unknown.join(', ')}`, 1)
  if (values.ask === true) {
    if (confirm === undefined) return fail('--ask needs an interactive terminal; ask the user, then pass --yes <path|slot> per item', 1)
    for (const row of rows.filter((candidate) => !KEPT_BUCKETS.has(candidate.bucket) && !named.rows.includes(candidate))) {
      if (await confirm(`remove ${row.bucket} ${row.path}?`)) {
        named.rows.push(row)
      }
    }
  }
  return removeRows(named.rows, mainRoot)
}

const subcommands = new Map<string, Command>([
  ['seed', worktreeSeed],
  ['deps', worktreeDeps],
  ['remove', worktreeRemove],
  ['sweep', (args) => worktreeSweep(args)],
])

export const runWorktree: Command = (args) => {
  const [name, ...rest] = args
  const subcommand = name === undefined ? undefined : subcommands.get(name)
  if (subcommand === undefined) return fail(`usage: worktree <${[...subcommands.keys()].join('|')}>`, 2)
  return subcommand(rest)
}
