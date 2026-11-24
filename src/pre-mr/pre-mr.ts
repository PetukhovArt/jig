import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig, type JigConfig } from '../core/config'
import { git, gitStatus, gitToplevel } from '../core/git'
import { appendJournal, readJournal, type JournalEntry, type JournalRecord } from '../core/journal'
import { ensureJigDir } from '../core/paths'
import { MAIN_AGENT } from '../core/state'
import { requireScopedChanges, resolveBase, splitPathspec, toRootPaths } from '../review/review-plan'
import { logToActiveJournal } from '../task-status/task-status'
import { listWorktrees } from '../worktree/list'
import { breakItMinutes, scopeOf, SCOPE_HINT, uiRequirements } from './ui-requirements'

export const VERIFY_LEVELS = ['unit-test', 'type-check', 'none'] as const

export type VerifyLevel = (typeof VERIFY_LEVELS)[number]

export interface Io {
  out: (text: string) => void
  err: (text: string) => void
}

export interface PreMrContext {
  cwd: string
  io: Io
}

export interface Gap {
  rule: string
  hint: string
  latest?: JournalRecord
}

export type Verdict =
  | { type: 'no-ui-section' }
  | { type: 'no-ui'; reason: string }
  | { type: 'proven'; proofs: JournalRecord[]; breakIt?: JournalRecord; breakItMinutes: number }
  | { type: 'skipped'; skip: JournalRecord; gaps: Gap[]; breakIt?: JournalRecord; breakItMinutes: number }
  | { type: 'missing'; gaps: Gap[]; skippable: boolean }

const EXIT_MISSING = 1
const EXIT_USAGE = 2
const CLI_SESSION = 'cli'
const MAX_BUFFER = 64 * 1024 * 1024

const isBreakIt = (entry: JournalRecord): boolean => entry.kind === 'break-it' || entry.kind === 'bug-bash'

const WAIVED_BY_SKIP: ReadonlySet<string> = new Set<string>(['ui-matrix'])

const PRE_MR_USAGE = 'usage: jig pre-mr [<base>] [-- <pathspec>...] | jig pre-mr break-it "<result>"'
const SKIP_USAGE = `usage: jig skip-verify --level ${VERIFY_LEVELS.join('|')} --why "<reason>"`

class UsageError extends Error {}

const isUsageError = (error: unknown): error is Error =>
  error instanceof UsageError ||
  (error instanceof TypeError && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS'))

const isVerifyLevel = (value: string | undefined): value is VerifyLevel => VERIFY_LEVELS.some((level) => level === value)

const gitLine = (args: string[], cwd: string): string | undefined => {
  const result = git(args, cwd)
  return result.ok ? result.stdout.split('\n')[0]?.trim() || undefined : undefined
}

const requireRoot = (cwd: string): string => {
  const root = gitToplevel(cwd)
  if (root === undefined) throw new Error('not inside a git repository')
  return root
}

/**
 * The tree object of the whole working tree as it is now, untracked files included and ignored files left out.
 * Built in a copy of the index, so the real index stays untouched. Worktrees share one object store,
 * so a tree written in a slot can be compared from the worktree where the code is written.
 */
export const workingTree = (root: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'jig-pre-mr-'))
  try {
    const index = join(dir, 'index')
    const current = gitLine(['rev-parse', '--git-path', 'index'], root)
    if (current !== undefined && existsSync(resolve(root, current))) copyFileSync(resolve(root, current), index)
    const withIndex = (args: string[]) =>
      spawnSync('git', args, { cwd: root, env: { ...process.env, GIT_INDEX_FILE: index }, encoding: 'utf8', windowsHide: true, maxBuffer: MAX_BUFFER })
    const added = withIndex(['add', '-A'])
    if (added.status !== 0) throw new Error(`git add -A into a temporary index failed: ${String(added.stderr).trim()}`)
    const tree = withIndex(['write-tree'])
    const sha = String(tree.stdout).trim()
    if (tree.status !== 0 || sha === '') throw new Error(`git write-tree failed: ${String(tree.stderr).trim()}`)
    return sha
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const snapshot = (root: string): { head: string; tree: string } => {
  const head = gitLine(['rev-parse', 'HEAD'], root)
  if (head === undefined) throw new Error('HEAD has no commit yet')
  return { head, tree: workingTree(root) }
}

const record = (root: string, entry: Omit<JournalEntry, 'session' | 'agent'>): JournalRecord =>
  appendJournal(root, { session: CLI_SESSION, agent: MAIN_AGENT, ...entry })

const mirror = (root: string, decision: string, fields: { why?: string; evidence?: string; result?: string }): void => {
  try {
    logToActiveJournal(root, { phase: 'verify', decision, ...fields })
  } catch {
    return
  }
}

const recordsOf = (root: string): JournalRecord[] => {
  let paths: string[]
  try {
    paths = listWorktrees(root).map((worktree) => worktree.path)
  } catch {
    paths = []
  }
  const seen = new Set<string>()
  const records: JournalRecord[] = []
  for (const path of [root, ...paths]) {
    const key = resolve(path).replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    records.push(...readJournal(path).filter((entry) => entry.kind === 'proof' || isBreakIt(entry) || entry.kind === 'skip-verify'))
  }
  return records.sort((left, right) => right.ts.localeCompare(left.ts))
}

const changedPaths = (root: string, older: string, newer: string): Set<string> | undefined => {
  const result = git(['diff', '--name-only', '--no-renames', '-z', older, newer], root)
  return result.ok ? new Set(result.stdout.split('\0').filter(Boolean)) : undefined
}

const branchCommits = (root: string, mergeBase: string, head: string): Set<string> => {
  const result = git(['rev-list', `${mergeBase}..${head}`], root)
  const commits = new Set(result.ok ? result.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : [])
  commits.add(head)
  return commits
}

export interface Evaluation {
  root: string
  mergeBase: string
  head: string
  tree: string
  files: string[]
  records: JournalRecord[]
  config: JigConfig
}

const ruleOf = (entry: JournalRecord): string => entry.rule ?? ''

export const evaluate = ({ root, mergeBase, head, tree, files, records, config }: Evaluation): Verdict => {
  if (config.ui === undefined) return { type: 'no-ui-section' }
  const commits = branchCommits(root, mergeBase, head)
  commits.add(mergeBase)
  const onBranch = (entry: JournalRecord): boolean => entry.head !== undefined && commits.has(entry.head)
  const proofsOf = (rule: string): JournalRecord[] => records.filter((entry) => entry.kind === 'proof' && ruleOf(entry) === rule)
  const scopeRecord = proofsOf('ui-scope').find((entry) => onBranch(entry) && scopeOf(entry) !== undefined)
  if (scopeRecord === undefined) return { type: 'missing', gaps: [{ rule: 'ui-scope', hint: SCOPE_HINT }], skippable: false }
  const scope = scopeOf(scopeRecord)
  if (scope?.value === 'none') return { type: 'no-ui', reason: scope.reason }
  const diffs = new Map<string, Set<string> | undefined>()
  const editedSince = (entry: JournalRecord): Set<string> | undefined => {
    const from = entry.tree ?? ''
    if (!diffs.has(from)) diffs.set(from, from === '' ? undefined : changedPaths(root, from, tree))
    return diffs.get(from)
  }
  const isFresh = (entry: JournalRecord): boolean => {
    const edited = editedSince(entry)
    return edited !== undefined && files.every((path) => !edited.has(path))
  }
  const gaps: Gap[] = []
  const proofs: JournalRecord[] = [scopeRecord]
  for (const { rule, hint, declaration } of uiRequirements(root, config)) {
    const candidates = proofsOf(rule)
    const proof = candidates.find((entry) => (declaration ? onBranch(entry) : isFresh(entry)))
    if (proof !== undefined) {
      proofs.push(proof)
      continue
    }
    const latest = candidates[0]
    gaps.push({ rule, hint, ...(latest === undefined ? {} : { latest }) })
  }
  const breakIt = records.find((entry) => isBreakIt(entry) && onBranch(entry))
  const advice = { ...(breakIt === undefined ? {} : { breakIt }), breakItMinutes: breakItMinutes(config) }
  if (gaps.length === 0) return { type: 'proven', proofs, ...advice }
  const skip = records.find((entry) => entry.kind === 'skip-verify' && entry.tree !== undefined && editedSince(entry)?.size === 0)
  if (skip === undefined) return { type: 'missing', gaps, skippable: gaps.some((gap) => WAIVED_BY_SKIP.has(gap.rule)) }
  const required = gaps.filter((gap) => !WAIVED_BY_SKIP.has(gap.rule))
  if (required.length > 0) return { type: 'missing', gaps: required, skippable: false }
  return { type: 'skipped', skip, gaps, ...advice }
}

const untrackedPaths = (root: string, paths: readonly string[]): string[] =>
  (gitStatus(root, paths) ?? []).filter((entry) => entry.status === '??').map((entry) => entry.path)

const levelLine = (skip: JournalRecord): string => `Verification level: ${skip.rule ?? 'none'} (${skip.message ?? 'no reason given'})`

const describeGap = (gap: Gap): string => {
  const state = gap.latest === undefined ? 'not recorded' : `last receipt at ${gap.latest.ts} (\`${gap.latest.message ?? ''}\`) predates edits`
  return `- ${gap.rule}: ${state}. Run: ${gap.hint}`
}

const breakItLine = (verdict: { breakIt?: JournalRecord; breakItMinutes: number }): string =>
  verdict.breakIt === undefined ? `Break-it: recommended (~${verdict.breakItMinutes} min), not recorded` : `Break-it: ${verdict.breakIt.message ?? ''}`

export const formatVerdict = (verdict: Verdict, baseLine: string): string[] => {
  switch (verdict.type) {
    case 'no-ui-section':
      return [baseLine, 'UI: no ui section in .jig/config.jsonc, not checked', 'Break-it: UI not touched', 'Verification level: full']
    case 'no-ui':
      return [baseLine, `UI scope: none (${verdict.reason})`, 'Break-it: UI not touched', 'Verification level: full']
    case 'proven':
      return [baseLine, ...[...new Set(verdict.proofs)].map((proof) => `proof: \`${proof.message ?? ''}\` at ${proof.ts}`), breakItLine(verdict), 'Verification level: full']
    case 'skipped':
      return [baseLine, `not proven: ${verdict.gaps.map((gap) => gap.rule).join(', ')}`, breakItLine(verdict), levelLine(verdict.skip)]
    case 'missing':
      return [
        baseLine,
        'pre-mr: the branch lacks UI receipts:',
        ...verdict.gaps.map(describeGap),
        verdict.skippable
          ? `The proof on a running app cannot run here: jig skip-verify --level ${VERIFY_LEVELS.join('|')} --why "<reason>"`
          : 'These need no running app, so jig skip-verify does not waive them.',
      ]
  }
}

const check = (args: string[], ctx: PreMrContext): number => {
  const split = splitPathspec(args)
  if (split.paths?.length === 0) throw new UsageError(PRE_MR_USAGE)
  const { positionals } = parseArgs({ args: split.options, allowPositionals: true, strict: true, options: {} })
  if (positionals.length > 1) throw new UsageError(PRE_MR_USAGE)
  const root = requireRoot(ctx.cwd)
  const paths = toRootPaths(root, ctx.cwd, split.paths ?? [])
  const base = resolveBase(root, positionals[0], 'pre-mr', paths)
  const files = [...new Set([...base.stats.map((stat) => stat.path), ...untrackedPaths(root, paths)])]
  requireScopedChanges(paths, files.length, base.ref)
  const { head, tree } = snapshot(root)
  const verdict = evaluate({ root, mergeBase: base.mergeBase, head, tree, files, records: recordsOf(root), config: loadConfig(root) })
  const baseLine = `base: ${base.ref} (merge base ${base.mergeBase.slice(0, 8)}, from ${base.source})`
  const lines = formatVerdict(verdict, baseLine)
  if (verdict.type === 'missing') {
    ctx.io.err(`${lines.join('\n')}\n`)
    return EXIT_MISSING
  }
  ctx.io.out(`${lines.join('\n')}\n`)
  return 0
}

const textArgument = (args: string[], usage: string): string => {
  const parts = args[0] === '--' ? args.slice(1) : args
  const text = parts.join(' ').trim()
  if (text === '' || (args[0] !== '--' && text.startsWith('-'))) throw new UsageError(usage)
  return text
}

export const recordUiProof = (root: string, kind: string, message: string): JournalRecord => {
  ensureJigDir(root)
  const entry = record(root, { kind: 'proof', tool: 'ui', rule: kind, message, ...snapshot(root) })
  mirror(root, `proof:${kind}`, { evidence: message, result: 'passed' })
  return entry
}

const breakIt = (args: string[], ctx: PreMrContext): number => {
  const result = textArgument(args, 'usage: jig pre-mr break-it "<bugs found and fixed, what could not be tested and why>"')
  const root = requireRoot(ctx.cwd)
  ensureJigDir(root)
  const entry = record(root, { kind: 'break-it', message: result, ...snapshot(root) })
  mirror(root, 'break-it', { result })
  ctx.io.out(`jig: recorded break-it at ${entry.ts}\n`)
  return 0
}

const withUsage = (run: () => number, io: Io): number => {
  try {
    return run()
  } catch (error) {
    if (!isUsageError(error)) throw error
    io.err(`jig: ${error.message}\n`)
    return EXIT_USAGE
  }
}

export const preMr = (args: string[], ctx: PreMrContext): number =>
  withUsage(() => {
    const [sub, ...rest] = args
    if (sub === 'break-it') return breakIt(rest, ctx)
    return check(args, ctx)
  }, ctx.io)

export const skipVerify = (args: string[], ctx: Pick<PreMrContext, 'cwd' | 'io'>): number =>
  withUsage(() => {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { level: { type: 'string' }, why: { type: 'string' } } })
    const why = values.why?.trim() ?? ''
    if (positionals.length > 0 || !isVerifyLevel(values.level) || why === '') throw new UsageError(SKIP_USAGE)
    const root = requireRoot(ctx.cwd)
    ensureJigDir(root)
    const entry = record(root, { kind: 'skip-verify', rule: values.level, message: why, ...snapshot(root) })
    mirror(root, `skip-verify:${values.level}`, { why })
    ctx.io.out(`${levelLine(entry)}\njig pre-mr passes with this level until the next edit\n`)
    return 0
  }, ctx.io)

const processIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}

export const runPreMr = (args: string[]): number => preMr(args, { cwd: process.cwd(), io: processIo })

export const runSkipVerify = (args: string[]): number => skipVerify(args, { cwd: process.cwd(), io: processIo })
