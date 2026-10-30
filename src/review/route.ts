import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { git } from '../core/git'

type Command = (args: string[]) => number

export type Route = 'thread' | 'promoted' | 'discussion' | 'fyi'

export interface Routed {
  route: Route
  id: string
  severity: string
  at: string
  victim?: string
}

interface CausedBy {
  file?: string
  line?: number
  diff_line?: string
  victim_line?: string
}

interface RouteFinding {
  id?: string
  file?: string
  line?: number
  severity?: string
  status?: string
  discussion_id?: string | null
  caused_by?: CausedBy | null
}

export interface RouteState {
  findings?: RouteFinding[]
  deepening?: unknown
}

interface DiffFile {
  shown: Set<number>
  changed: Set<string>
}

const FORGE_CONTEXT_LINES = 3

const gitOut = (root: string, args: string[]): string => {
  const result = git(args, root)
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

const parseDiff = (patch: string): Map<string, DiffFile> => {
  const files = new Map<string, DiffFile>()
  let current: DiffFile | undefined
  for (const line of patch.split('\n')) {
    const header = /^\+\+\+ (?:b\/)?(.*)$/.exec(line)
    if (header !== null) {
      const path = header[1] ?? ''
      current = path === '/dev/null' ? undefined : { shown: new Set(), changed: new Set() }
      if (current !== undefined) files.set(path, current)
      continue
    }
    if (current === undefined || line.startsWith('--- ')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk !== null) {
      const start = Number(hunk[1])
      const length = hunk[2] === undefined ? 1 : Number(hunk[2])
      for (let offset = 0; offset < length; offset++) current.shown.add(start + offset)
    } else if (line.startsWith('+') || line.startsWith('-')) {
      current.changed.add(line.slice(1).trim())
    }
  }
  return files
}

const fileAt = (root: string, sha: string, path: string): string[] | undefined => {
  const result = git(['show', `${sha}:${path}`], root)
  return result.ok ? result.stdout.split('\n').map((line) => line.trim()) : undefined
}

const isPostable = (finding: RouteFinding, held: ReadonlySet<string>): boolean =>
  !held.has(finding.id ?? '') && (finding.status === 'optional' || (finding.status === 'open' && (finding.discussion_id ?? undefined) === undefined))

/**
 * The posting route of every postable finding of a state against the merge request diff `<base>...<head>`:
 * a line the forge shows on the new side → `thread`; a diff file off its hunks, or an Important outside the diff → `discussion`;
 * outside the diff with a `caused_by` the diff proves → `promoted` on the cause line; the rest outside the diff, `optional` and the deepening → `fyi`.
 */
export const routeFindings = (root: string, state: RouteState, base: string, head: string, hold: readonly string[] = []): Routed[] => {
  const diff = parseDiff(gitOut(root, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-M', `-U${FORGE_CONTEXT_LINES}`, `${base}...${head}`]))
  const held = new Set(hold)
  const isProvenCause = (finding: RouteFinding, cause: CausedBy): boolean => {
    const causeFile = cause.file === undefined ? undefined : diff.get(cause.file)
    if (causeFile === undefined || cause.diff_line === undefined || cause.victim_line === undefined || finding.file === undefined) return false
    return causeFile.changed.has(cause.diff_line.trim()) && (fileAt(root, head, finding.file)?.includes(cause.victim_line.trim()) ?? false)
  }
  const routeOf = (finding: RouteFinding): Routed => {
    const severity = finding.status === 'optional' ? 'optional' : (finding.severity ?? '?')
    const at = `${finding.file ?? '?'}:${finding.line ?? '?'}`
    const item = { id: finding.id ?? at, severity, at }
    if (finding.status === 'optional') return { route: 'fyi', ...item }
    const file = finding.file === undefined ? undefined : diff.get(finding.file)
    if (file !== undefined) return { route: finding.line !== undefined && file.shown.has(finding.line) ? 'thread' : 'discussion', ...item }
    const cause = finding.caused_by ?? undefined
    if (cause !== undefined && isProvenCause(finding, cause)) return { route: 'promoted', ...item, at: `${cause.file}:${cause.line ?? '?'}`, victim: at }
    return { route: finding.severity === 'Important' ? 'discussion' : 'fyi', ...item }
  }
  const routed = (state.findings ?? []).filter((finding) => isPostable(finding, held)).map(routeOf)
  return state.deepening === undefined || state.deepening === null ? routed : [...routed, { route: 'fyi', id: 'deepening', severity: 'deepening', at: '' }]
}

const ROUTES: readonly Route[] = ['thread', 'promoted', 'discussion', 'fyi']

export const formatRoutes = (routed: readonly Routed[]): string[] => [
  ...routed.map((item) => [item.route, item.id, item.severity, item.at, ...(item.victim === undefined ? [] : [`victim ${item.victim}`])].join('\t')),
  `routes: ${ROUTES.map((route) => `${routed.filter((item) => item.route === route).length} ${route}`).join(' · ')}`,
]

const USAGE = 'usage: jig review route <state file> <base_sha> <head_sha> [--hold <id>]...'

export const runReviewRoute: Command = (args) => {
  const { values, positionals } = parseArgs({ args, options: { hold: { type: 'string', multiple: true } }, allowPositionals: true, strict: true })
  const [path, base, head] = positionals
  if (path === undefined || base === undefined || head === undefined || positionals.length > 3) throw new Error(USAGE)
  const state = JSON.parse(readFileSync(path, 'utf8')) as RouteState
  process.stdout.write(`${formatRoutes(routeFindings(process.cwd(), state, base, head, values.hold ?? [])).join('\n')}\n`)
  return 0
}
