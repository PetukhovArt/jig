import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { toSlash } from '../core/paths'
import { EnvironmentError } from './exec'
import { parseReviewState, reviewStatePath } from './state'

export const LEGACY_STATE_DIR = 'claude-review'

export const defaultImportDir = (): string => join(tmpdir(), LEGACY_STATE_DIR)

export const legacyStateKey = (remote: string, iid: number): string => createHash('sha1').update(`${remote}:${iid}`).digest('hex').slice(0, 12)

const LEGACY_FILE = /^(.+)-([0-9a-f]{12})\.json$/
const MAX_IID = 99_999

const TOP_FIELDS: ReadonlySet<string> = new Set([
  'key', 'remote', 'target', 'source_branch', 'base_sha', 'last_reviewed_sha', 'diff_hash', 'runs', 'tokens', 'timings', 'tally', 'findings', 'deepening',
])
const FINDING_FIELDS: ReadonlySet<string> = new Set([
  'id', 'file', 'line', 'angle', 'category', 'severity', 'severity_class', 'severity_gate', 'verdict', 'models', 'summary', 'mrComment',
  'caused_by', 'discussion_id', 'status', 'blocks', 'spec_quote',
])

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const hintedIid = (target: unknown): number | undefined => {
  const text = typeof target === 'string' || typeof target === 'number' ? String(target) : ''
  const match = /^!?(\d+)$/.exec(text) ?? /merge_requests\/(\d+)/.exec(text) ?? /pull\/(\d+)/.exec(text)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

export const legacyIid = (raw: Json, remote: string, fileKey: string): number | undefined => {
  const hinted = hintedIid(raw['target'])
  if (hinted !== undefined && legacyStateKey(remote, hinted) === fileKey) return hinted
  for (let iid = 1; iid <= MAX_IID; iid++) if (legacyStateKey(remote, iid) === fileKey) return iid
  return undefined
}

export interface Converted {
  state: Json
  dropped: string[]
}

export const convertLegacyState = (raw: Json, jigKey: string, iid: number): Converted => {
  const dropped = new Set<string>()
  const state: Json = {}
  for (const [field, value] of Object.entries(raw)) {
    if (TOP_FIELDS.has(field)) state[field] = value
    else if (field !== 'degraded') dropped.add(field)
  }
  state['key'] = jigKey
  state['target'] = String(iid)
  const tally: Json = isObject(raw['tally']) ? { ...raw['tally'] } : {}
  const degraded = raw['degraded']
  const movesDegraded = typeof degraded === 'string' && degraded.trim() !== '' && tally['degraded'] === undefined
  if (movesDegraded) tally['degraded'] = degraded
  else if (degraded !== undefined) dropped.add('degraded')
  state['tally'] = tally
  const findings = Array.isArray(raw['findings']) ? raw['findings'] : []
  state['findings'] = findings.map((finding: unknown) => {
    const kept: Json = {}
    for (const [field, value] of Object.entries(isObject(finding) ? finding : {})) {
      if (FINDING_FIELDS.has(field)) kept[field] = value
      else dropped.add(`findings[].${field}`)
    }
    return kept
  })
  return { state, dropped: [...dropped].sort() }
}

const finishedAt = (raw: unknown, path: string): number => {
  const stamp = isObject(raw) && isObject(raw['timings']) ? raw['timings']['finished_at'] : undefined
  const parsed = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN
  return Number.isNaN(parsed) ? statSync(path).mtimeMs : parsed
}

export interface ImportOptions {
  from: string
  mainRoot: string
  remote: string
  dryRun: boolean
  now?: Date
}

export interface ImportResult {
  lines: string[]
  imported: number
  skipped: number
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

/**
 * Writes into `<mainRoot>/.jig/runs/review/` the old skills' state files of `remote` found in `from`.
 * An existing jig state is kept unless the old run finished later; then it is backed up as
 * `<file>.bak-import-<time>` before being replaced. Throws EnvironmentError when `from` is missing.
 */
export const importLegacyStates = (options: ImportOptions): ImportResult => {
  const { from, mainRoot, remote, dryRun } = options
  if (!existsSync(from)) throw new EnvironmentError(`no such directory ${toSlash(from)}`)
  const lines: string[] = []
  let imported = 0
  let skipped = 0
  let other = 0
  const skip = (label: string, reason: string): void => {
    skipped++
    lines.push(`SKIP\t${label}\t${reason}`)
  }
  for (const name of readdirSync(from).sort()) {
    const fileKey = LEGACY_FILE.exec(name)?.[2]
    if (fileKey === undefined) continue
    const source = join(from, name)
    const raw = readJson(source)
    if (!isObject(raw) || raw['remote'] !== remote) {
      other++
      continue
    }
    const iid = legacyIid(raw, remote, fileKey)
    if (iid === undefined) {
      skip(name, 'no merge request number matches the file key')
      continue
    }
    const label = `!${iid}\t${name}`
    try {
      parseReviewState(JSON.stringify(raw), name)
    } catch (error) {
      skip(label, error instanceof Error ? error.message : String(error))
      continue
    }
    const destination = reviewStatePath(mainRoot, remote, String(iid))
    const { state, dropped } = convertLegacyState(raw, basename(destination, '.json'), iid)
    if (existsSync(destination)) {
      const current = readJson(destination)
      if (sameJson(current, state)) {
        skip(label, 'already imported')
        continue
      }
      if (current !== undefined && finishedAt(current, destination) >= finishedAt(raw, source)) {
        skip(label, `jig state ${toSlash(destination)} is as new or newer`)
        continue
      }
      if (!dryRun) copyFileSync(destination, `${destination}.bak-import-${(options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')}`)
    }
    if (!dryRun) {
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, `${JSON.stringify(state, null, 2)}\n`)
    }
    imported++
    lines.push(`${dryRun ? 'WOULD IMPORT' : 'IMPORTED'}\t${label}\t${toSlash(destination)}${dropped.length > 0 ? `\tdropped ${dropped.join(', ')}` : ''}`)
  }
  lines.push(`import-state: ${imported} ${dryRun ? 'to import' : 'imported'}, ${skipped} skipped, ${other} of other repositories (from ${toSlash(from)})`)
  return { lines, imported, skipped }
}
