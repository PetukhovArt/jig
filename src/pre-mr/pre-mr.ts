import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileSource } from '../catalog/languages'
import { CHECKS, PROOF_KINDS, type CheckDefinition, type ProofKind } from '../checks'
import { enabledSetting, loadConfig } from '../core/config'
import { git, gitStatus, gitToplevel } from '../core/git'
import { appendJournal, readJournal, type JournalEntry, type JournalRecord } from '../core/journal'
import { ensureJigDir } from '../core/paths'
import { MAIN_AGENT } from '../core/state'
import { resolveBase } from '../review/review-plan'
import { logToActiveJournal } from '../task-status/task-status'
import { listWorktrees } from '../worktree/list'

export const VERIFY_LEVELS = ['unit-test', 'type-check', 'none'] as const

export type VerifyLevel = (typeof VERIFY_LEVELS)[number]

export interface Io {
  out: (text: string) => void
  err: (text: string) => void
}

/** Runs a proof command through the shell with the terminal attached; returns its exit code. */
export type Exec = (command: string, cwd: string) => number

export interface PreMrContext {
  cwd: string
  io: Io
  exec: Exec
}

export interface Requirement {
  kind: ProofKind
  files: string[]
}

export type Gap =
  | { what: 'proof'; kind: ProofKind; files: string[]; latest?: JournalRecord; hint: string }
  | { what: 'bug-bash' }

export type Verdict =
  | { type: 'no-ui' }
  | { type: 'no-proof-tool'; files: string[] }
  | { type: 'proven'; proofs: JournalRecord[]; bugBash: JournalRecord }
  | { type: 'skipped'; skip: JournalRecord; gaps: Gap[]; bugBash?: JournalRecord }
  | { type: 'missing'; gaps: Gap[] }

const EXIT_MISSING = 1
const EXIT_USAGE = 2
const CLI_SESSION = 'cli'
const MAX_BUFFER = 64 * 1024 * 1024

const PRE_MR_USAGE = 'usage: jig pre-mr [<base>] | jig pre-mr proof "<command>" | jig pre-mr bug-bash "<result>"'
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

/** Drops directory prefixes and Windows launcher extensions, so `C:\bin\agent-view.cmd act replay` reads as `agent-view act replay`. */
const normalizeCommand =(command: string): string =>
  command
    .replace(/["']/g, '')
    .replace(/[^\s;&|]*[\\/](?=[^\s\\/;&|]+(?:\s|$))/g, '')
    .replace(/\.(?:cmd|exe|bat|ps1)(?=\s|$)/gi, '')

export const provenKinds = (command: string): { check: string; kinds: readonly ProofKind[] }[] => {
  const normalized = normalizeCommand(command)
  return CHECKS.map((check) => ({ check: check.name, kinds: check.proves(normalized) })).filter((entry) => entry.kinds.length > 0)
}

/** Proof tools the project names in its config; without one, pre-mr asks for no UI proof. */
export const configuredChecks = (root: string): CheckDefinition[] => {
  const { proofs } = loadConfig(root)
  return CHECKS.filter((check) => enabledSetting(proofs, check.name) !== undefined)
}

export const requirements = (root: string, files: readonly string[], checks: readonly CheckDefinition[] = CHECKS): Requirement[] =>
  PROOF_KINDS.map((kind) => ({
    kind,
    files: files.filter((file) => checks.some((check) => check.requires(file, fileSource(root, file)).includes(kind))),
  })).filter(
    (requirement) => requirement.files.length > 0,
  )

const hintFor = (kind: ProofKind): string => CHECKS.map((check) => check.hints[kind]).find((hint) => hint !== undefined) ?? kind

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
    records.push(...readJournal(path).filter((entry) => entry.kind === 'proof' || entry.kind === 'bug-bash' || entry.kind === 'skip-verify'))
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
  checks: readonly CheckDefinition[]
}

export const evaluate = ({ root, mergeBase, head, tree, files, records, checks }: Evaluation): Verdict => {
  const needed = requirements(root, files, checks)
  if (needed.length === 0) {
    const ui = requirements(root, files).flatMap((requirement) => requirement.files)
    return ui.length === 0 ? { type: 'no-ui' } : { type: 'no-proof-tool', files: [...new Set(ui)] }
  }
  const diffs = new Map<string, Set<string> | undefined>()
  const editedSince = (entry: JournalRecord): Set<string> | undefined => {
    const from = entry.tree ?? ''
    if (!diffs.has(from)) diffs.set(from, from === '' ? undefined : changedPaths(root, from, tree))
    return diffs.get(from)
  }
  const covers = (entry: JournalRecord, paths: readonly string[]): boolean => {
    const edited = editedSince(entry)
    return edited !== undefined && paths.every((path) => !edited.has(path))
  }
  const gaps: Gap[] = []
  const proofs: JournalRecord[] = []
  for (const { kind, files: kindFiles } of needed) {
    const candidates = records.filter((entry) => entry.kind === 'proof' && (entry.rule ?? '').split(',').includes(kind))
    const proof = candidates.find((entry) => covers(entry, kindFiles))
    if (proof !== undefined) {
      proofs.push(proof)
      continue
    }
    const latest = candidates[0]
    gaps.push({ what: 'proof', kind, files: kindFiles, hint: hintFor(kind), ...(latest === undefined ? {} : { latest }) })
  }
  const commits = branchCommits(root, mergeBase, head)
  const bugBash = records.find((entry) => entry.kind === 'bug-bash' && entry.head !== undefined && commits.has(entry.head))
  if (bugBash === undefined) gaps.push({ what: 'bug-bash' })
  if (gaps.length === 0 && bugBash !== undefined) return { type: 'proven', proofs, bugBash }
  const skip = records.find((entry) => entry.kind === 'skip-verify' && entry.tree !== undefined && editedSince(entry)?.size === 0)
  if (skip === undefined) return { type: 'missing', gaps }
  return { type: 'skipped', skip, gaps, ...(bugBash === undefined ? {} : { bugBash }) }
}

const untrackedPaths = (root: string): string[] => (gitStatus(root) ?? []).filter((entry) => entry.status === '??').map((entry) => entry.path)

const levelLine = (skip: JournalRecord): string => `Verification level: ${skip.rule ?? 'none'} (${skip.message ?? 'no reason given'})`

const fileList = (files: readonly string[]): string => {
  const shown = files.slice(0, 5).join(', ')
  return files.length > 5 ? `${shown} and ${files.length - 5} more` : shown
}

const describeGap = (gap: Gap): string => {
  if (gap.what === 'bug-bash') return '- bug-bash: no record on this branch. Run flows/bug-bash.md on your diff, then: jig pre-mr bug-bash "<bugs found and fixed, what could not be tested>"'
  const state = gap.latest === undefined ? 'never proven' : `last proof at ${gap.latest.ts} (\`${gap.latest.message ?? ''}\`) predates edits`
  return `- ${gap.kind}: ${state} for ${fileList(gap.files)}. Run: jig pre-mr proof "${gap.hint}"`
}

export const formatVerdict = (verdict: Verdict, baseLine: string): string[] => {
  switch (verdict.type) {
    case 'no-ui':
      return [baseLine, 'UI files: none', 'Bug-bash: UI not touched', 'Verification level: full']
    case 'no-proof-tool':
      return [
        baseLine,
        `UI files: ${fileList(verdict.files)}; no UI proof tool in .jig/config.jsonc, UI not proven`,
        'Bug-bash: not run, no UI proof tool configured',
        'Verification level: no UI proof tool configured',
      ]
    case 'proven':
      return [
        baseLine,
        ...[...new Set(verdict.proofs)].map((proof) => `proof: \`${proof.message ?? ''}\` at ${proof.ts}`),
        `Bug-bash: ${verdict.bugBash.message ?? ''}`,
        'Verification level: full',
      ]
    case 'skipped':
      return [
        baseLine,
        `not proven: ${verdict.gaps.map((gap) => (gap.what === 'proof' ? gap.kind : gap.what)).join(', ')}`,
        `Bug-bash: ${verdict.bugBash?.message ?? 'not run, verification skipped'}`,
        levelLine(verdict.skip),
      ]
    case 'missing':
      return [
        baseLine,
        'pre-mr: the branch touches UI files and lacks:',
        ...verdict.gaps.map(describeGap),
        `The proof cannot run here: jig skip-verify --level ${VERIFY_LEVELS.join('|')} --why "<reason>"`,
      ]
  }
}

const check = (args: string[], ctx: PreMrContext): number => {
  const { positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {} })
  if (positionals.length > 1) throw new UsageError(PRE_MR_USAGE)
  const root = requireRoot(ctx.cwd)
  const base = resolveBase(root, positionals[0], 'pre-mr')
  const files = [...new Set([...base.stats.map((stat) => stat.path), ...untrackedPaths(root)])]
  const { head, tree } = snapshot(root)
  const verdict = evaluate({ root, mergeBase: base.mergeBase, head, tree, files, records: recordsOf(root), checks: configuredChecks(root) })
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

const proof = (args: string[], ctx: PreMrContext): number => {
  const command = textArgument(args, `usage: jig pre-mr proof "<command>", e.g. jig pre-mr proof "${hintFor('behavior')}"`)
  const proven = provenKinds(command)
  if (proven.length === 0) {
    const hints = PROOF_KINDS.map(hintFor).join('`, `')
    throw new UsageError(`\`${command}\` proves nothing jig knows; proof commands: \`${hints}\``)
  }
  const root = requireRoot(ctx.cwd)
  ensureJigDir(root)
  const state = snapshot(root)
  const code = ctx.exec(command, ctx.cwd)
  if (code !== 0) {
    ctx.io.err(`jig: \`${command}\` exited ${code}; no proof recorded\n`)
    return code
  }
  for (const { check: name, kinds } of proven) {
    const entry = record(root, { kind: 'proof', tool: name, rule: kinds.join(','), message: command, ...state })
    mirror(root, `proof:${kinds.join(',')}`, { evidence: command, result: 'passed' })
    ctx.io.out(`jig: recorded ${kinds.join(', ')} proof at ${entry.ts}\n`)
  }
  return 0
}

const bugBash = (args: string[], ctx: PreMrContext): number => {
  const result = textArgument(args, 'usage: jig pre-mr bug-bash "<bugs found and fixed, what could not be tested and why>"')
  const root = requireRoot(ctx.cwd)
  ensureJigDir(root)
  const entry = record(root, { kind: 'bug-bash', message: result, ...snapshot(root) })
  mirror(root, 'bug-bash', { result })
  ctx.io.out(`jig: recorded bug-bash at ${entry.ts}\n`)
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
    if (sub === 'proof') return proof(rest, ctx)
    if (sub === 'bug-bash') return bugBash(rest, ctx)
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

const shellExec: Exec = (command, cwd) => {
  const result = spawnSync(command, { cwd, shell: true, stdio: 'inherit', windowsHide: true })
  if (result.error !== undefined) {
    process.stderr.write(`jig: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

const processIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}

export const runPreMr = (args: string[]): number => preMr(args, { cwd: process.cwd(), io: processIo, exec: shellExec })

export const runSkipVerify = (args: string[]): number => skipVerify(args, { cwd: process.cwd(), io: processIo })
