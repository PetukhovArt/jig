import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig, type SlotsConfig } from '../core/config'
import { git } from '../core/git'
import { parseJsonc } from '../core/jsonc'
import { ensureJigDir, resolveProjectRoot, toSlash } from '../core/paths'
import { acquireLock, findInPath } from '../core/proc'

type Command = (args: string[]) => number | Promise<number>

export interface Worktree {
  path: string
  branch?: string
  isPrunable: boolean
}

export interface SlotWorktree extends Worktree {
  slot: number
}

type Bucket = 'hold-wip' | 'hold-open-mr' | 'recent' | 'safe'

const SLOT_LOCK = 'slot.lock'
const AGENT_VIEW_CONFIG = 'agent-view.config.json'
const RECENT_MS = 24 * 60 * 60 * 1000
const MS_PER_SECOND = 1000
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ENV_FILE = /^\.env/
const NO_VALUE = 'none'

const fail = (message: string, code: number): number => {
  process.stderr.write(`jig: ${message}\n`)
  return code
}

const print = (text: string): void => {
  process.stdout.write(`${text}\n`)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parseWorktreeList = (porcelain: string): Worktree[] => {
  const worktrees: Worktree[] = []
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    const pathLine = lines.find((line) => line.startsWith('worktree '))
    if (pathLine === undefined) continue
    const branchLine = lines.find((line) => line.startsWith('branch '))
    const worktree: Worktree = {
      path: resolve(pathLine.slice('worktree '.length)),
      isPrunable: lines.some((line) => line === 'prunable' || line.startsWith('prunable ')),
    }
    if (branchLine !== undefined) {
      worktree.branch = branchLine.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
    worktrees.push(worktree)
  }
  return worktrees
}

export const slotNumber = (dirName: string, repo: string): number | undefined => {
  const match = new RegExp(`^${escapeRegExp(repo)}-s(\\d+)(?:-|$)`).exec(dirName)
  if (match?.[1] === undefined) return undefined
  const slot = Number(match[1])
  return slot >= 1 ? slot : undefined
}

export const slotWorktrees = (worktrees: readonly Worktree[], repo: string): SlotWorktree[] =>
  worktrees.flatMap((worktree) => {
    const slot = slotNumber(basename(worktree.path), repo)
    return slot === undefined ? [] : [{ ...worktree, slot }]
  })

export const findDuplicates = (slots: readonly SlotWorktree[]): Map<number, SlotWorktree[]> => {
  const bySlot = new Map<number, SlotWorktree[]>()
  for (const slot of slots) {
    bySlot.set(slot.slot, [...(bySlot.get(slot.slot) ?? []), slot])
  }
  return new Map([...bySlot].filter(([, group]) => group.length > 1))
}

export const lowestFreeSlot = (slots: readonly SlotWorktree[]): number => {
  const taken = new Set(slots.map((slot) => slot.slot))
  let slot = 1
  while (taken.has(slot)) {
    slot++
  }
  return slot
}

const slotDirName = (repo: string, slot: number, slug?: string): string =>
  slug === undefined ? `${repo}-s${slot}` : `${repo}-s${slot}-${slug}`

const slotPorts = (config: SlotsConfig, slot: number): Record<string, number> =>
  Object.fromEntries(Object.entries(config.ports ?? {}).map(([key, port]) => [key, port.base + slot * port.step]))

const slotCdpPort = (config: SlotsConfig, slot: number): number | undefined =>
  config.cdp === undefined ? undefined : config.cdp.base + slot * config.cdp.step

export const setEnvValue = (text: string, key: string, value: string): string => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const line = new RegExp(`^([ \\t]*(?:export[ \\t]+)?)${escapeRegExp(key)}[ \\t]*=.*$`, 'gm')
  if (line.test(text)) return text.replace(line, (_match, prefix: string) => `${prefix}${key}=${value}`)
  const separator = text === '' || text.endsWith('\n') ? '' : eol
  return `${text}${separator}${key}=${value}${eol}`
}

const agentViewConfig = (
  base: Record<string, unknown>,
  config: SlotsConfig,
  cdpPort: number,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...base, port: cdpPort }
  const runtime = config.verifyRuntime ?? config.runtime
  if (runtime !== undefined && runtime !== 'none') {
    result['runtime'] = runtime
  }
  if (result['launch'] === undefined && config.dev !== undefined) {
    result['launch'] = config.dev
  }
  return result
}

const formatPorts = (ports: Record<string, number>): string => {
  const entries = Object.entries(ports).map(([key, value]) => `${key}=${value}`)
  return entries.length === 0 ? NO_VALUE : entries.join(' ')
}

const listWorktrees = (cwd: string): Worktree[] => {
  const result = git(['worktree', 'list', '--porcelain'], cwd)
  if (!result.ok) throw new Error(`git worktree list failed: ${result.stderr.trim()}`)
  return parseWorktreeList(result.stdout)
}

interface SlotContext {
  projectRoot: string
  mainRoot: string
  repo: string
  slots?: SlotsConfig
}

const loadContext = (): SlotContext => {
  const projectRoot = resolveProjectRoot(process.cwd())
  const config = loadConfig(projectRoot)
  if (config.error !== undefined) throw new Error(`.jig/config.jsonc: ${config.error}`)
  const mainRoot = listWorktrees(projectRoot)[0]?.path ?? projectRoot
  const context: SlotContext = { projectRoot, mainRoot, repo: basename(mainRoot) }
  if (config.slots !== undefined) {
    context.slots = config.slots
  }
  return context
}

const formatDuplicates = (duplicates: Map<number, SlotWorktree[]>): string =>
  [...duplicates]
    .map(([slot, group]) => `s${slot}: ${group.map((worktree) => toSlash(worktree.path)).join(', ')}`)
    .join('; ')

const isTracked = (dir: string, file: string): boolean => git(['ls-files', '--error-unmatch', '--', file], dir).ok

const writeLocalFile = (dir: string, file: string, content: string): void => {
  const path = join(dir, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  if (isTracked(dir, file)) {
    git(['update-index', '--skip-worktree', '--', file], dir)
  }
}

const insideDir = (dir: string, file: string): string => {
  const path = resolve(dir, file)
  const rel = relative(dir, path)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path ${file} leaves the slot dir`)
  return path
}

const copyFromMain = (mainRoot: string, dir: string, copyFiles: readonly string[]): void => {
  const rootEnvFiles = readdirSync(mainRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ENV_FILE.test(entry.name))
    .map((entry) => entry.name)
  for (const file of new Set([...rootEnvFiles, ...copyFiles])) {
    const source = join(mainRoot, file)
    if (!existsSync(source)) {
      process.stderr.write(`jig: copyFiles ${file} is missing in ${toSlash(mainRoot)}\n`)
      continue
    }
    cpSync(source, insideDir(dir, file), { recursive: true })
  }
}

const writePorts = (dir: string, slots: SlotsConfig, slot: number): void => {
  for (const [key, port] of Object.entries(slots.ports ?? {})) {
    const path = insideDir(dir, port.target)
    const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    writeLocalFile(dir, port.target, setEnvValue(text, key, String(port.base + slot * port.step)))
  }
}

const readJsonObject = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {}
  const value = parseJsonc(readFileSync(path, 'utf8'))
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
  return isObject ? (value as Record<string, unknown>) : {}
}

const writeAgentView = (mainRoot: string, dir: string, slots: SlotsConfig, cdpPort: number): void => {
  const own = join(dir, AGENT_VIEW_CONFIG)
  const base = readJsonObject(existsSync(own) ? own : join(mainRoot, AGENT_VIEW_CONFIG))
  writeLocalFile(dir, AGENT_VIEW_CONFIG, `${JSON.stringify(agentViewConfig(base, slots, cdpPort), null, 2)}\n`)
}

const branchExists = (cwd: string, branch: string): boolean =>
  git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd).ok

const worktreeAddArgs = (cwd: string, dir: string, branch: string | undefined): string[] => {
  if (branch === undefined) return ['worktree', 'add', '--detach', dir]
  return branchExists(cwd, branch) ? ['worktree', 'add', dir, branch] : ['worktree', 'add', dir, '-b', branch]
}

interface Reserved {
  slot: number
  dir: string
}

const reserveSlot = async (
  context: SlotContext,
  slots: SlotsConfig,
  options: { slug?: string; branch?: string },
): Promise<Reserved | number> => {
  const lock = await acquireLock(join(ensureJigDir(context.mainRoot).cache, SLOT_LOCK))
  if (lock === undefined) return fail('slot new is running elsewhere, retry', 1)
  try {
    git(['worktree', 'prune'], context.projectRoot)
    const worktrees = listWorktrees(context.projectRoot)
    const taken = slotWorktrees(worktrees, context.repo)
    const duplicates = findDuplicates(taken)
    if (duplicates.size > 0) return fail(`duplicate slot numbers: ${formatDuplicates(duplicates)}`, 1)
    for (const prunable of taken.filter((worktree) => worktree.isPrunable)) {
      process.stderr.write(`jig: s${prunable.slot} stays prunable after prune: ${toSlash(prunable.path)}\n`)
    }
    const slot = lowestFreeSlot(taken)
    const dir = resolve(context.mainRoot, slots.worktreesDir, slotDirName(context.repo, slot, options.slug))
    const added = git(worktreeAddArgs(context.projectRoot, dir, options.branch), context.projectRoot)
    if (!added.ok) return fail(`git worktree add failed: ${added.stderr.trim()}`, 2)
    return { slot, dir }
  } finally {
    lock.release()
  }
}

const runInstall = (install: string, dir: string): number | null =>
  spawnSync(install, { cwd: dir, shell: true, windowsHide: true, stdio: ['ignore', 2, 2] }).status

const slotNew = async (args: string[]): Promise<number> => {
  const { values } = parseArgs({ args, options: { slug: { type: 'string' }, branch: { type: 'string' } }, strict: true })
  const slug = values.slug
  if (slug !== undefined && !SLUG.test(slug)) return fail(`invalid --slug ${slug}: use letters, digits, ., _, -`, 2)
  const context = loadContext()
  const slots = context.slots
  if (slots === undefined) return fail('no slots section in .jig/config.jsonc: a human fills it (see skill jig-slots)', 1)
  const reserved = await reserveSlot(context, slots, {
    ...(slug === undefined ? {} : { slug }),
    ...(values.branch === undefined ? {} : { branch: values.branch }),
  })
  if (typeof reserved === 'number') return reserved
  const { slot, dir } = reserved
  copyFromMain(context.mainRoot, dir, slots.copyFiles ?? [])
  writePorts(dir, slots, slot)
  const cdpPort = slotCdpPort(slots, slot)
  if (cdpPort !== undefined) {
    writeAgentView(context.mainRoot, dir, slots, cdpPort)
  }
  for (const cache of slots.clearCache ?? []) {
    rmSync(insideDir(dir, cache), { recursive: true, force: true })
  }
  if (slots.install !== undefined) {
    const status = runInstall(slots.install, dir)
    if (status !== 0) return fail(`install failed (exit ${status}) in slot ${slot} ${toSlash(dir)}`, 1)
  }
  print(`slot ${slot} ${toSlash(dir)} ports ${formatPorts(slotPorts(slots, slot))} cdp ${cdpPort ?? NO_VALUE}`)
  return 0
}

interface SlotRow {
  slot: number
  path: string
  branch: string | null
  ports: Record<string, number>
  cdp: number | null
}

const slotLs = (args: string[]): number => {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } }, strict: true })
  const context = loadContext()
  const rows: SlotRow[] = slotWorktrees(listWorktrees(context.projectRoot), context.repo)
    .sort((left, right) => left.slot - right.slot)
    .map((worktree) => ({
      slot: worktree.slot,
      path: toSlash(worktree.path),
      branch: worktree.branch ?? null,
      ports: context.slots === undefined ? {} : slotPorts(context.slots, worktree.slot),
      cdp: context.slots === undefined ? null : (slotCdpPort(context.slots, worktree.slot) ?? null),
    }))
  if (values.json === true) {
    print(JSON.stringify(rows, null, 2))
    return 0
  }
  for (const row of rows) {
    print(`s${row.slot}  ${row.path}  ${row.branch ?? '(detached)'}  ports ${formatPorts(row.ports)}  cdp ${row.cdp ?? NO_VALUE}`)
  }
  return 0
}

const slotRm = (args: string[]): number => {
  const { values, positionals } = parseArgs({
    args,
    options: { force: { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  })
  const slot = Number(positionals[0]?.replace(/^s/, ''))
  if (positionals.length !== 1 || !Number.isInteger(slot) || slot < 1) return fail('usage: slot rm <N> [--force]', 2)
  const context = loadContext()
  const matches = slotWorktrees(listWorktrees(context.projectRoot), context.repo).filter((worktree) => worktree.slot === slot)
  const [worktree] = matches
  if (worktree === undefined) return fail(`no slot ${slot}`, 1)
  if (matches.length > 1) return fail(`duplicate slot numbers: ${formatDuplicates(new Map([[slot, matches]]))}`, 1)
  const isForced = values.force === true
  const status = git(['status', '--porcelain=v1', '--untracked-files=no'], worktree.path)
  const changes = status.stdout.split(/\r?\n/).filter(Boolean)
  if (!isForced && changes.length > 0) {
    return fail(`slot ${slot} has tracked changes, commit them or pass --force: ${changes.map((line) => line.slice(3)).join(', ')}`, 1)
  }
  const removed = git(['worktree', 'remove', '--force', worktree.path], context.projectRoot)
  if (!removed.ok) return fail(`git worktree remove failed: ${removed.stderr.trim()}`, 1)
  print(`removed ${toSlash(worktree.path)}`)
  return 0
}

const runJson = (bin: string, args: string[], cwd: string): unknown => {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return undefined
  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    return undefined
  }
}

const branchNames = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: Record<string, unknown>) => (typeof item[field] === 'string' ? [item[field]] : []))
}

const openMrBranches = (cwd: string): Set<string> => {
  const remote = git(['remote', 'get-url', 'origin'], cwd).stdout
  const isGithub = remote.includes('github.com')
  const tool = isGithub ? findInPath('gh') : findInPath('glab')
  if (tool === undefined) return new Set()
  const branches = isGithub
    ? branchNames(runJson(tool, ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'headRefName'], cwd), 'headRefName')
    : branchNames(runJson(tool, ['mr', 'list', '--per-page', '100', '--output', 'json'], cwd), 'source_branch')
  return new Set(branches)
}

const isRecent = (path: string, now: number): boolean => {
  const result = git(['log', '-1', '--format=%ct'], path)
  const committedAt = Number(result.stdout.trim()) * MS_PER_SECOND
  return result.ok && now - committedAt < RECENT_MS
}

const bucketOf = (worktree: Worktree, openBranches: Set<string>, now: number): Bucket => {
  const status = git(['status', '--porcelain=v1'], worktree.path)
  if (status.stdout.trim() !== '') return 'hold-wip'
  if (worktree.branch !== undefined && openBranches.has(worktree.branch)) return 'hold-open-mr'
  return isRecent(worktree.path, now) ? 'recent' : 'safe'
}

const slotSweep = (args: string[]): number => {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } }, strict: true })
  const context = loadContext()
  const worktrees = listWorktrees(context.projectRoot).filter((worktree) => worktree.path !== context.mainRoot)
  const openBranches = openMrBranches(context.projectRoot)
  const now = Date.now()
  const rows = worktrees.map((worktree) => ({
    bucket: bucketOf(worktree, openBranches, now),
    slot: slotNumber(basename(worktree.path), context.repo) ?? null,
    path: toSlash(worktree.path),
    branch: worktree.branch ?? null,
  }))
  if (values.json === true) {
    print(JSON.stringify(rows, null, 2))
    return 0
  }
  for (const row of rows) {
    const slot = row.slot === null ? '' : `  slot ${row.slot}`
    print(`${row.bucket}  ${row.path}  ${row.branch ?? '(detached)'}${slot}`)
  }
  return 0
}

const subcommands = new Map<string, Command>([
  ['new', slotNew],
  ['ls', slotLs],
  ['rm', slotRm],
  ['sweep', slotSweep],
])

export const runSlot: Command = (args) => {
  const [name, ...rest] = args
  const subcommand = name === undefined ? undefined : subcommands.get(name)
  if (subcommand === undefined) return fail(`usage: slot <${[...subcommands.keys()].join('|')}>`, 2)
  return subcommand(rest)
}
