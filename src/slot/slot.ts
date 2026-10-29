import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig, type PortConfig, type SlotsConfig, type WorktreeConfig } from '../core/config'
import { git } from '../core/git'
import { parseJsonc } from '../core/jsonc'
import { ensureJigDir, resolveProjectRoot, toSlash } from '../core/paths'
import { acquireLock } from '../core/proc'
import { listWorktrees, type Worktree } from '../worktree/list'
import { installSteps } from '../worktree/lockfiles'
import { formatDeps, hasIgnoredLockKeyChange, provideDeps, type DepsOutcome } from '../worktree/deps-pool'
import { removeLinkedWorktree } from '../worktree/remove'
import { formatSeed, seedWorktree } from '../worktree/seed'

type Command = (args: string[]) => number | Promise<number>

export interface SlotWorktree extends Worktree {
  slot: number
}

const SLOT_LOCK = 'slot.lock'
const AGENT_VIEW_CONFIG = 'agent-view.config.json'
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const NO_VALUE = 'none'

const fail = (message: string, code: number): number => {
  process.stderr.write(`jig: ${message}\n`)
  return code
}

const print = (text: string): void => {
  process.stdout.write(`${text}\n`)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/**
 * The main checkout's app URL as the slot sees it: a local port that a `ports` entry starts at moves with the slot,
 * another local port is dropped (it would reach slot 0), a remote URL stays.
 */
export const slotUrl = (url: string, ports: Readonly<Record<string, PortConfig>>, slot: number): string | undefined => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!LOCAL_HOSTS.has(parsed.hostname) || parsed.port === '') return url
  const port = Object.values(ports).find((entry) => entry.base === Number(parsed.port))
  if (port === undefined) return undefined
  parsed.port = String(port.base + slot * port.step)
  return parsed.toString()
}

const agentViewConfig = (
  base: Record<string, unknown>,
  config: SlotsConfig,
  slot: number,
  cdpPort: number,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...base, port: cdpPort }
  if (typeof base['url'] === 'string') {
    const url = slotUrl(base['url'], config.ports ?? {}, slot)
    if (url === undefined) {
      delete result['url']
      process.stderr.write(`jig: agent-view url ${base['url']} names a local port no slots.ports entry starts at: left out of the slot's ${AGENT_VIEW_CONFIG}\n`)
    } else {
      result['url'] = url
    }
  }
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

export interface SlotContext {
  projectRoot: string
  mainRoot: string
  repo: string
  slots?: SlotsConfig
  worktree?: WorktreeConfig
}

export const loadContext = (): SlotContext => {
  const projectRoot = resolveProjectRoot(process.cwd())
  const config = loadConfig(projectRoot)
  if (config.error !== undefined) throw new Error(`.jig/config.jsonc: ${config.error}`)
  const mainRoot = listWorktrees(projectRoot)[0]?.path ?? projectRoot
  const context: SlotContext = { projectRoot, mainRoot, repo: basename(mainRoot) }
  if (config.slots !== undefined) {
    context.slots = config.slots
  }
  if (config.worktree !== undefined) {
    context.worktree = config.worktree
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

const writeEnv = (dir: string, target: string, key: string, value: number): void => {
  const path = insideDir(dir, target)
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  writeLocalFile(dir, target, setEnvValue(text, key, String(value)))
}

const writePorts = (dir: string, slots: SlotsConfig, slot: number): void => {
  for (const [key, port] of Object.entries(slots.ports ?? {})) {
    writeEnv(dir, port.target, key, port.base + slot * port.step)
  }
  if (slots.slotEnv !== undefined) {
    writeEnv(dir, slots.slotEnv.target, slots.slotEnv.key, slot)
  }
}

const readJsonObject = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {}
  const value = parseJsonc(readFileSync(path, 'utf8'))
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
  return isObject ? (value as Record<string, unknown>) : {}
}

const writeAgentView = (mainRoot: string, dir: string, slots: SlotsConfig, slot: number, cdpPort: number): void => {
  const own = join(dir, AGENT_VIEW_CONFIG)
  const base = readJsonObject(existsSync(own) ? own : join(mainRoot, AGENT_VIEW_CONFIG))
  writeLocalFile(dir, AGENT_VIEW_CONFIG, `${JSON.stringify(agentViewConfig(base, slots, slot, cdpPort), null, 2)}\n`)
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

const poolDeps = (context: SlotContext, dir: string): DepsOutcome | undefined => {
  const depsPool = context.worktree?.depsPool
  if (depsPool === undefined) return undefined
  const outcome = provideDeps(dir, { main: context.mainRoot, install: context.slots?.install, after: depsPool.after })
  for (const line of formatDeps(outcome)) {
    process.stderr.write(`jig: ${line}\n`)
  }
  return outcome
}

const isPoolServed = (outcome: DepsOutcome | undefined): boolean => outcome !== undefined && outcome.kind !== 'skipped'

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
  for (const line of formatSeed(seedWorktree(context.mainRoot, dir, context.worktree))) {
    process.stderr.write(`jig: ${line}\n`)
  }
  writePorts(dir, slots, slot)
  const cdpPort = slotCdpPort(slots, slot)
  if (cdpPort !== undefined) {
    writeAgentView(context.mainRoot, dir, slots, slot, cdpPort)
  }
  for (const cache of slots.clearCache ?? []) {
    rmSync(insideDir(dir, cache), { recursive: true, force: true })
  }
  const deps = poolDeps(context, dir)
  if (deps?.kind === 'failed') return fail(`install failed in slot ${slot} ${toSlash(dir)}: ${deps.detail}`, 1)
  if (!isPoolServed(deps) && slots.install !== undefined) {
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

const parseSlotNumber = (text: string | undefined): number | undefined => {
  const slot = Number(text?.replace(/^s/, ''))
  return Number.isInteger(slot) && slot >= 1 ? slot : undefined
}

const findSlot = (context: SlotContext, slot: number): SlotWorktree | string => {
  const matches = slotWorktrees(listWorktrees(context.projectRoot), context.repo).filter((worktree) => worktree.slot === slot)
  const [worktree] = matches
  if (worktree === undefined) return `no slot ${slot}`
  if (matches.length > 1) return `duplicate slot numbers: ${formatDuplicates(new Map([[slot, matches]]))}`
  return worktree
}

const trackedChanges = (dir: string): string[] =>
  git(['status', '--porcelain=v1', '--untracked-files=no'], dir)
    .stdout.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3))

const slotRm = (args: string[]): number => {
  const { values, positionals } = parseArgs({
    args,
    options: { force: { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  })
  const slot = parseSlotNumber(positionals[0])
  if (positionals.length !== 1 || slot === undefined) return fail('usage: slot rm <N> [--force]', 2)
  const context = loadContext()
  const worktree = findSlot(context, slot)
  if (typeof worktree === 'string') return fail(worktree, 1)
  const changes = trackedChanges(worktree.path)
  if (values.force !== true && changes.length > 0) {
    return fail(`slot ${slot} has tracked changes, commit them or pass --force: ${changes.join(', ')}`, 1)
  }
  const removed = removeLinkedWorktree(worktree.path, context.projectRoot)
  if (removed.error !== undefined) return fail(`git worktree remove failed: ${removed.error}`, 1)
  print(`removed ${toSlash(worktree.path)}`)
  return 0
}

const headOf = (dir: string): string | undefined => {
  const result = git(['rev-parse', 'HEAD'], dir)
  return result.ok ? result.stdout.trim() : undefined
}

const changedFiles = (dir: string, from: string, to: string): string[] =>
  from === to ? [] : git(['diff', '--name-only', '-z', from, to], dir).stdout.split('\0').filter(Boolean)

const slotShow = (args: string[]): number => {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true, strict: true })
  const [slotText, ref] = positionals
  const slot = parseSlotNumber(slotText)
  if (positionals.length !== 2 || slot === undefined || ref === undefined) return fail('usage: slot show <N> <branch|commit>', 2)
  const context = loadContext()
  const worktree = findSlot(context, slot)
  if (typeof worktree === 'string') return fail(worktree, 1)
  const changes = trackedChanges(worktree.path)
  if (changes.length > 0) {
    return fail(`slot ${slot} has tracked changes; a slot only shows branches, edits belong in a feature worktree: ${changes.join(', ')}`, 1)
  }
  const before = headOf(worktree.path)
  const checkout = git(['checkout', '--detach', ref], worktree.path)
  if (!checkout.ok) return fail(`git checkout --detach ${ref} failed in slot ${slot}: ${checkout.stderr.trim()}`, 1)
  const after = headOf(worktree.path)
  const changed = before === undefined || after === undefined ? [] : changedFiles(worktree.path, before, after)
  const steps = installSteps(changed, context.slots?.install)
  const isRootDepsChange = steps.some((step) => step.dir === '.') || hasIgnoredLockKeyChange(worktree.path, changed)
  const deps = isRootDepsChange ? poolDeps(context, worktree.path) : undefined
  if (deps?.kind === 'failed') return fail(`install failed in slot ${slot} ${toSlash(worktree.path)}: ${deps.detail}`, 1)
  for (const step of steps.filter((candidate) => candidate.dir !== '.' || !isPoolServed(deps))) {
    process.stderr.write(`jig: lock file changed, running ${step.command} in ${step.dir}\n`)
    const status = runInstall(step.command, resolve(worktree.path, step.dir))
    if (status !== 0) return fail(`install failed (exit ${status}) in slot ${slot} ${toSlash(worktree.path)}`, 1)
  }
  print(`slot ${slot} ${toSlash(worktree.path)} at ${(after ?? '').slice(0, 12)} ${ref}`)
  return 0
}

const subcommands = new Map<string, Command>([
  ['new', slotNew],
  ['show', slotShow],
  ['ls', slotLs],
  ['rm', slotRm],
])

export const runSlot: Command = (args) => {
  const [name, ...rest] = args
  const subcommand = name === undefined ? undefined : subcommands.get(name)
  if (subcommand === undefined) return fail(`usage: slot <${[...subcommands.keys()].join('|')}>`, 2)
  return subcommand(rest)
}
