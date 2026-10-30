import { existsSync, readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig, type ForgeName } from '../core/config'
import { git } from '../core/git'
import { toSlash } from '../core/paths'
import { diffHash } from '../review/scope'
import { listWorktrees, samePath } from '../worktree/list'
import { defaultAdapter, resolveAdapterPath, scriptAdapter, type ProcessAdapter, type QueueRow } from './adapter'
import { BlockedRefError, EnvironmentError, spawnExec, type Exec } from './exec'
import {
  countUnresolved,
  lastCommit,
  needsHeadSha,
  preDecision,
  reviewDecision,
  SKIP_REASONS,
  skipOutcome,
  standingBlocking,
  threadFacts,
  type Decision,
  type SkipReason,
  type ThreadFacts,
} from './filter'
import { createForge, detectForge, type Forge, type Head } from './forge'
import { defaultImportDir, importLegacyStates } from './import-state'
import {
  blockingFindings,
  mergeInState,
  parseReviewState,
  parseTally,
  readReviewState,
  reconcile,
  reviewStatePath,
  specHold,
  standingFindings,
  withdrawFromState,
} from './state'
import { applyVerdicts, foldVerdicts, OUTCOMES, type MrOutcome, type Outcome } from './verdict'

type Command = (args: string[]) => number

export interface CycleDeps {
  exec: Exec
  cwd: string
  print: (line: string) => void
}

const USAGE = [
  'usage: jig review-cycle <subcommand>',
  '  queue [--adapter <path>] [--json]',
  '  state-path <mr> [--repo <dir>]',
  '  import-state [--from <dir>] [--repo <dir>] [--dry-run]',
  '  base-check [--adapter <path>]',
  '  spec <refs> [--adapter <path>]',
  '  reconcile <state-before|none> <tally-file|tally-json>',
  '  unresolved <mr> [--repo <dir>]',
  '  standing <mr> [--repo <dir>]',
  '  head <mr> [--reviewed <sha>] [--repo <dir>]',
  '  spec-hold <state> <spec>',
  '  withdraw <mr> <discussion-id>... [--repo <dir>]',
  '  merge <mr> <keep-discussion-id> <duplicate-discussion-id>... --note <file> [--repo <dir>]',
  '  verdict <refs>=<outcome>... [--adapter <path>] [--dry-run]',
].join('\n')

class UsageError extends Error {}

const DEFAULT_WORKTREES_DIR = '..'

interface Repo {
  mainRoot: string
  remote: string
  forge: Forge
  worktreesDir: string
}

const worktreesOf = (dir: string): ReturnType<typeof listWorktrees> => {
  try {
    return listWorktrees(dir)
  } catch (error) {
    throw new EnvironmentError(error instanceof Error ? error.message : String(error))
  }
}

const repoContext = (dir: string, exec: Exec): Repo => {
  const remote = git(['remote', 'get-url', 'origin'], dir)
  if (!remote.ok) throw new EnvironmentError(`no origin remote in ${toSlash(dir)}`)
  const mainRoot = worktreesOf(dir)[0]?.path
  if (mainRoot === undefined) throw new EnvironmentError(`not a git repository: ${toSlash(dir)}`)
  const config = loadConfig(mainRoot)
  if (config.error !== undefined) throw new EnvironmentError(`.jig/config.jsonc: ${config.error}`)
  const url = remote.stdout.trim()
  const forgeName: ForgeName = config.reviewCycle?.forge ?? detectForge(url)
  return {
    mainRoot,
    remote: url,
    forge: createForge(forgeName, exec, mainRoot),
    worktreesDir: config.slots?.worktreesDir ?? DEFAULT_WORKTREES_DIR,
  }
}

const adapterFor = (repo: Repo, flag: string | undefined, deps: CycleDeps): ProcessAdapter => {
  if (flag !== undefined) return scriptAdapter(resolveAdapterPath(flag, deps.cwd), deps.exec, repo.mainRoot)
  const configured = loadConfig(repo.mainRoot).reviewCycle?.processAdapter
  if (configured !== undefined) return scriptAdapter(resolveAdapterPath(configured, repo.mainRoot), deps.exec, repo.mainRoot)
  return defaultAdapter(repo.forge, repo.mainRoot)
}

/** Where the cycle puts the review worktree of one merge request: the jig worktree location, named per repo and merge request. */
export const reviewWorktreePath = (repo: Pick<Repo, 'mainRoot' | 'worktreesDir'>, iid: number): string =>
  resolve(repo.mainRoot, repo.worktreesDir, `${basename(repo.mainRoot)}-review-${iid}`)

const fetched = (root: string, ref: string): string | undefined =>
  git(['fetch', '-q', '--no-tags', 'origin', ref], root).ok ? git(['rev-parse', 'FETCH_HEAD'], root).stdout.trim() : undefined

const hasCommit = (root: string, sha: string): boolean => git(['cat-file', '-e', `${sha}^{commit}`], root).ok || fetched(root, sha) !== undefined

/** Fetches the target and the head into the main checkout; false when either cannot be fetched or diffed. */
const hasReviewedDiff = (root: string, head: Head, reviewedHash: string): boolean => {
  const target = head.target === '' ? undefined : fetched(root, head.target)
  if (target === undefined) return false
  if (!hasCommit(root, head.sha)) return false
  try {
    return diffHash(root, `${target}...${head.sha}`) === reviewedHash
  } catch {
    return false
  }
}

const isBusy = (repo: Repo, worktree: string): boolean =>
  existsSync(worktree) || worktreesOf(repo.mainRoot).some((entry) => samePath(entry.path, worktree))

export type QueueEntry =
  | { kind: 'actionable'; row: QueueRow; worktree: string; state: string | undefined; standing: number; threads: ThreadFacts; lastCommit: string | undefined }
  | { kind: 'skip'; row: QueueRow; reason: SkipReason; outcome: Outcome; threads: ThreadFacts | undefined; lastCommit: string | undefined }
  | { kind: 'blocked'; row: QueueRow; reason: string }

const judgeRow = (row: QueueRow, adapter: ProcessAdapter, repos: (dir: string) => Repo): QueueEntry => {
  try {
    const repo = repos(row.repoDir)
    const worktree = reviewWorktreePath(repo, row.iid)
    const pre = preDecision({ approved: row.approved, draft: row.draft, busy: isBusy(repo, worktree) })
    if (pre?.kind === 'skip') return { kind: 'skip', row, reason: pre.reason, outcome: skipOutcome(pre.reason, 0), threads: undefined, lastCommit: undefined }
    const staleRule = adapter.rules(row.refs).get('stale') === 'on'
    const statePath = reviewStatePath(repo.mainRoot, repo.remote, String(row.iid))
    const state = readReviewState(statePath)
    const me = repo.forge.me()
    const discussions = repo.forge.discussions(row.iid)
    const threads = threadFacts(discussions, me)
    const latestCommit = lastCommit(repo.forge.commitDates(row.iid))
    const reviewedSha = state?.lastReviewedSha
    const head = needsHeadSha(threads, reviewedSha) ? repo.forge.head(row.iid) : undefined
    const headSha = head?.sha
    const reviewedDiff = head !== undefined && head.sha !== reviewedSha && state?.diffHash !== undefined && hasReviewedDiff(repo.mainRoot, head, state.diffHash)
    const decision: Decision = reviewDecision({ staleRule, threads, lastCommit: latestCommit, reviewedSha, headSha, reviewedDiff })
    if (decision.kind === 'skip') {
      const blocking = state === undefined ? 0 : standingBlocking(blockingFindings(state), discussions)
      return { kind: 'skip', row, reason: decision.reason, outcome: skipOutcome(decision.reason, blocking), threads, lastCommit: latestCommit }
    }
    return {
      kind: 'actionable',
      row,
      worktree,
      state: state === undefined ? undefined : statePath,
      standing: state === undefined ? 0 : standingFindings(state).length,
      threads,
      lastCommit: latestCommit,
    }
  } catch (error) {
    if (error instanceof EnvironmentError || error instanceof BlockedRefError) return { kind: 'blocked', row, reason: error.message }
    throw error
  }
}

const facts = (threads: ThreadFacts | undefined, commit: string | undefined): string =>
  threads === undefined ? '' : `\tlast_commit=${commit ?? 'none'}\tmy_last_note=${threads.myLastNote ?? 'none'}\tmy_unresolved=${threads.myUnresolved}`

const formatEntry = (entry: QueueEntry): string => {
  const { row } = entry
  const id = `${row.refs}\t${toSlash(row.repoDir)}\t${row.iid}`
  switch (entry.kind) {
    case 'actionable':
      return `ACTIONABLE\t${id}\t${row.sourceBranch}\t${row.webUrl}\tworktree=${toSlash(entry.worktree)}\tstate=${entry.state === undefined ? 'none' : toSlash(entry.state)}\tstanding=${entry.standing}${facts(entry.threads, entry.lastCommit)}`
    case 'skip':
      return `SKIP\t${entry.reason}\t${id}\t${row.webUrl}\toutcome=${entry.outcome}${facts(entry.threads, entry.lastCommit)}`
    case 'blocked':
      return `BLOCKED\t${id}\t${row.webUrl}\t${entry.reason}`
    default: {
      const unreachable: never = entry
      return unreachable
    }
  }
}

export const skippedLine = (entries: readonly QueueEntry[]): string | undefined => {
  const counts = SKIP_REASONS.map((reason) => [reason, entries.filter((entry) => entry.kind === 'skip' && entry.reason === reason).length] as const).filter(
    ([, count]) => count > 0,
  )
  const total = counts.reduce((sum, [, count]) => sum + count, 0)
  return total === 0 ? undefined : `skipped: ${total} (${counts.map(([reason, count]) => `${reason} ${count}`).join(', ')})`
}

const flagOptions = {
  adapter: { type: 'string' },
  json: { type: 'boolean' },
  repo: { type: 'string' },
  from: { type: 'string' },
  reviewed: { type: 'string' },
  note: { type: 'string' },
  'dry-run': { type: 'boolean' },
} as const

interface Parsed {
  values: { adapter?: string; json?: boolean; repo?: string; from?: string; reviewed?: string; note?: string; 'dry-run'?: boolean }
  positionals: string[]
}

const parse = (args: string[]): Parsed => {
  try {
    return parseArgs({ args, options: flagOptions, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

const mrNumber = (value: string | undefined): number => {
  const match = /^!?(\d+)$/.exec(value ?? '')
  if (match?.[1] === undefined) throw new UsageError(`expected a merge request number, got ${value ?? 'nothing'}`)
  return Number(match[1])
}

const queue = (args: string[], deps: CycleDeps): number => {
  const { values } = parse(args)
  const cache = new Map<string, Repo>()
  const repos = (dir: string): Repo => {
    const key = toSlash(resolve(dir)).toLowerCase()
    const known = cache.get(key)
    if (known !== undefined) return known
    const repo = repoContext(dir, deps.exec)
    cache.set(key, repo)
    return repo
  }
  const home = repos(deps.cwd)
  const adapter = adapterFor(home, values.adapter, deps)
  const discovered = adapter.queue()
  const entries = discovered.rows.map((row) => judgeRow(row, adapter, repos))
  if (values.json === true) {
    deps.print(JSON.stringify({ adapter: adapter.label, warning: adapter.warning, entries, notes: discovered.notes }, null, 2))
    return 0
  }
  if (adapter.warning !== undefined) deps.print(`WARNING\t${adapter.warning}`)
  deps.print(`adapter: ${adapter.label}`)
  entries.forEach((entry) => deps.print(formatEntry(entry)))
  discovered.notes.forEach((note) => deps.print(`NOTE\t${note.refs}\t${note.text}`))
  const skipped = skippedLine(entries)
  if (skipped !== undefined) deps.print(skipped)
  return 0
}

const statePath = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  const repo = repoContext(resolve(deps.cwd, values.repo ?? '.'), deps.exec)
  deps.print(toSlash(reviewStatePath(repo.mainRoot, repo.remote, String(mrNumber(positionals[0])))))
  return 0
}

const importState = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  if (positionals.length > 0) throw new UsageError(`import-state takes no positional arguments, got ${positionals.join(' ')}`)
  const repo = repoContext(resolve(deps.cwd, values.repo ?? '.'), deps.exec)
  const dryRun = values['dry-run'] === true
  const probe = toSlash(relative(repo.mainRoot, reviewStatePath(repo.mainRoot, repo.remote, '0')))
  if (!dryRun && !git(['check-ignore', '-q', probe], repo.mainRoot).ok) {
    throw new EnvironmentError(`${probe} is not gitignored in ${toSlash(repo.mainRoot)}: ignore .jig/runs/ first`)
  }
  const from = values.from === undefined ? defaultImportDir() : resolve(deps.cwd, values.from)
  importLegacyStates({ from, mainRoot: repo.mainRoot, remote: repo.remote, dryRun }).lines.forEach((line) => deps.print(line))
  return 0
}

const baseCheck = (args: string[], deps: CycleDeps): number => {
  const { values } = parse(args)
  adapterFor(repoContext(deps.cwd, deps.exec), values.adapter, deps)
    .baseCheck()
    .forEach((line) => deps.print(line))
  return 0
}

const spec = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  const [refs] = positionals
  if (refs === undefined) throw new UsageError('spec needs <refs>')
  const path = adapterFor(repoContext(deps.cwd, deps.exec), values.adapter, deps).spec(refs)
  if (path !== undefined) deps.print(path)
  return 0
}

const readText = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new EnvironmentError(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const reconcileCommand = (args: string[], deps: CycleDeps): number => {
  const { positionals } = parse(args)
  const [beforePath, tallyArg] = positionals
  if (beforePath === undefined || tallyArg === undefined) throw new UsageError('reconcile needs <state-before|none> <tally>')
  const tally = parseTally(tallyArg.trim().startsWith('{') ? tallyArg : readText(resolve(deps.cwd, tallyArg)))
  const before = beforePath === 'none' ? undefined : parseReviewState(readText(resolve(deps.cwd, beforePath)), beforePath)
  const result = reconcile(before, tally)
  if (result.kind === 'ok') {
    deps.print(`OK\tstanding=${result.standing}\taccounted=${result.accounted}`)
    return 0
  }
  deps.print(`BLOCKED\t${result.reason}`)
  if (result.firstRun) deps.print('first run: delete the state file this run wrote, so the next run is a full review again')
  return 1
}

const unresolved = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  const repo = repoContext(resolve(deps.cwd, values.repo ?? '.'), deps.exec)
  deps.print(String(countUnresolved(repo.forge.discussions(mrNumber(positionals[0])))))
  return 0
}

const standing = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  const iid = mrNumber(positionals[0])
  const repo = repoContext(resolve(deps.cwd, values.repo ?? '.'), deps.exec)
  const state = readReviewState(reviewStatePath(repo.mainRoot, repo.remote, String(iid)))
  deps.print(String(state === undefined ? 0 : standingBlocking(blockingFindings(state), repo.forge.discussions(iid))))
  return 0
}

const commitsBetween = (root: string, from: string, to: string): string => {
  if (!hasCommit(root, from) || !hasCommit(root, to)) return 'unknown'
  const count = git(['rev-list', '--count', `${from}..${to}`], root)
  return count.ok ? count.stdout.trim() : 'unknown'
}

const headCommand = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  const iid = mrNumber(positionals[0])
  const repo = repoContext(resolve(deps.cwd, values.repo ?? '.'), deps.exec)
  const reviewed = values.reviewed ?? readReviewState(reviewStatePath(repo.mainRoot, repo.remote, String(iid)))?.lastReviewedSha
  if (reviewed === undefined) throw new UsageError(`head needs --reviewed <sha>: no last_reviewed_sha in the state of !${iid}`)
  const head = repo.forge.head(iid).sha
  if (head === reviewed) {
    deps.print(`UNCHANGED\t${head}`)
    return 0
  }
  deps.print(`MOVED\t${reviewed}\t${head}\tcommits=${commitsBetween(repo.mainRoot, reviewed, head)}`)
  return 1
}

const specHoldCommand = (args: string[], deps: CycleDeps): number => {
  const { positionals } = parse(args)
  const [state, specFile] = positionals
  if (state === undefined || specFile === undefined) throw new UsageError('spec-hold needs <state> <spec>')
  const parsed = parseReviewState(readText(resolve(deps.cwd, state)), state)
  specHold(parsed, readText(resolve(deps.cwd, specFile))).forEach((id) => deps.print(id))
  return 0
}

const withdraw = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  const [mr, ...ids] = positionals
  const iid = mrNumber(mr)
  if (ids.length === 0) throw new UsageError('withdraw needs at least one discussion id')
  const repo = repoContext(resolve(deps.cwd, values.repo ?? '.'), deps.exec)
  const path = reviewStatePath(repo.mainRoot, repo.remote, String(iid))
  const me = repo.forge.me()
  const gone: string[] = []
  const writeState = (): void => {
    const count = withdrawFromState(path, gone)
    deps.print(existsSync(path) ? `state: ${toSlash(path)} · findings withdrawn: ${count}` : 'state: none')
  }
  try {
    for (const id of ids) {
      const discussion = repo.forge.discussion(iid, id)
      if (discussion === undefined) {
        gone.push(id)
        deps.print(`MISSING ${id}`)
        continue
      }
      const notes = discussion.notes.filter((note) => !note.system)
      const other = notes.find((note) => note.author !== me)
      if (other !== undefined) {
        deps.print(`REFUSED ${id} reply by ${other.author}, a human decides`)
        continue
      }
      if (notes.length === 0) {
        deps.print(`REFUSED ${id} no note of mine`)
        continue
      }
      for (const note of [...notes].reverse()) repo.forge.deleteNote(iid, note.id)
      gone.push(id)
      deps.print(`DELETED ${id} ${notes.length}`)
    }
  } catch (error) {
    writeState()
    throw error
  }
  writeState()
  return 0
}

const merge = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  const [mr, keep, ...duplicates] = positionals
  const iid = mrNumber(mr)
  if (keep === undefined || duplicates.length === 0) throw new UsageError('merge needs <keep-discussion-id> and at least one duplicate discussion id')
  if (values.note === undefined) throw new UsageError('merge needs --note <file>: the reply each duplicate thread gets before it is resolved')
  const note = readText(resolve(deps.cwd, values.note)).trim()
  if (note === '') throw new UsageError(`merge: ${values.note} is empty`)
  const repo = repoContext(resolve(deps.cwd, values.repo ?? '.'), deps.exec)
  if (repo.forge.discussion(iid, keep) === undefined) throw new EnvironmentError(`no thread ${keep} on !${iid} to keep`)
  const path = reviewStatePath(repo.mainRoot, repo.remote, String(iid))
  const me = repo.forge.me()
  const merged: string[] = []
  const writeState = (): void => {
    const count = mergeInState(path, merged)
    deps.print(existsSync(path) ? `state: ${toSlash(path)} · findings merged: ${count}` : 'state: none')
  }
  try {
    for (const id of duplicates) {
      const discussion = repo.forge.discussion(iid, id)
      if (discussion === undefined) {
        deps.print(`MISSING ${id}`)
        continue
      }
      const opening = discussion.notes.find((item) => !item.system)
      if (opening === undefined || opening.author !== me) {
        deps.print(`REFUSED ${id} opened by ${opening?.author ?? 'nobody'}, not by you`)
        continue
      }
      repo.forge.reply(iid, id, note)
      repo.forge.resolve(iid, id)
      merged.push(id)
      deps.print(`MERGED ${id} → ${keep}`)
    }
  } catch (error) {
    writeState()
    throw error
  }
  writeState()
  return 0
}

const HELD_ALIASES = new Set(['skipped', 'blocked', 'stale', 'unchanged', 'draft', 'busy', 'open'])

const isOutcome = (word: string): word is Outcome => (OUTCOMES as readonly string[]).includes(word)

const parseOutcome = (arg: string): MrOutcome => {
  const split = arg.lastIndexOf('=')
  const refs = arg.slice(0, split)
  const word = arg.slice(split + 1)
  if (split <= 0) throw new UsageError(`expected <refs>=<outcome>, got ${arg}`)
  if (isOutcome(word)) return { refs, outcome: word }
  if (HELD_ALIASES.has(word)) return { refs, outcome: 'held' }
  throw new UsageError(`unknown outcome ${word}: expected ${OUTCOMES.join(', ')} or ${[...HELD_ALIASES].join(', ')}`)
}

const verdict = (args: string[], deps: CycleDeps): number => {
  const { values, positionals } = parse(args)
  if (positionals.length === 0) throw new UsageError('verdict needs <refs>=<outcome>...')
  const outcomes = positionals.map(parseOutcome)
  const adapter = adapterFor(repoContext(deps.cwd, deps.exec), values.adapter, deps)
  const lines = applyVerdicts(adapter, foldVerdicts(outcomes), values['dry-run'] === true)
  lines.forEach((line) => deps.print(line.text))
  return lines.some((line) => line.failed) ? 3 : 0
}

const subcommands = new Map<string, (args: string[], deps: CycleDeps) => number>([
  ['queue', queue],
  ['state-path', statePath],
  ['import-state', importState],
  ['base-check', baseCheck],
  ['spec', spec],
  ['reconcile', reconcileCommand],
  ['unresolved', unresolved],
  ['standing', standing],
  ['head', headCommand],
  ['spec-hold', specHoldCommand],
  ['withdraw', withdraw],
  ['merge', merge],
  ['verdict', verdict],
])

/** Exit codes: 0 done, 1 reconcile blocked or the head moved, 2 usage, 3 the environment could not answer (never a verdict). */
export const runReviewCycleWith = (args: string[], deps: CycleDeps): number => {
  const [name, ...rest] = args
  const subcommand = name === undefined ? undefined : subcommands.get(name)
  if (subcommand === undefined) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  try {
    return subcommand(rest, deps)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`jig review-cycle ${name}: ${error.message}\n${USAGE}\n`)
      return 2
    }
    if (error instanceof EnvironmentError || error instanceof BlockedRefError) {
      process.stderr.write(`ERROR ${error.message}\n`)
      return error.exitCode
    }
    throw error
  }
}

export const runReviewCycle: Command = (args) =>
  runReviewCycleWith(args, { exec: spawnExec, cwd: process.cwd(), print: (line) => process.stdout.write(`${line}\n`) })
