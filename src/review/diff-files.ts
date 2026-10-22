import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../core/git'
import { ensureJigDir, toSlash } from '../core/paths'
import { listWorktrees } from '../worktree/list'

export const DIFF_PART_MAX_LINES = 1500
const DIFF_DIR_PREFIX = 'diff-'
const DIFF_DIR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const AUDIENCES = ['code', 'tests', 'docs'] as const
export type Audience = (typeof AUDIENCES)[number]

export interface DiffPart {
  name: string
  text: string
}

export interface DiffFileRange {
  path: string
  audience: Audience
  part: string
  start: number
  end: number
}

export interface DiffFiles {
  dir: string
  index: string
  parts: string[]
  audiences: Record<Audience, string[]>
}

const chunkPath = (chunk: readonly string[]): string => {
  const side = (prefix: string): string | undefined => {
    const line = chunk.find((candidate) => candidate.startsWith(prefix))
    const path = line?.slice(prefix.length).replace(/\r$/, '')
    return path === undefined || path === '/dev/null' ? undefined : path.replace(/^[ab]\//, '')
  }
  const header = /^diff --git a\/(.*) b\/(.*?)\r?$/.exec(chunk[0] ?? '')
  return side('+++ ') ?? side('--- ') ?? header?.[2] ?? chunk[0] ?? ''
}

const partName = (audience: Audience, index: number): string => `${audience}-${String(index + 1).padStart(2, '0')}.diff`

/** Each audience gets its own parts; a file's diff is never split: one longer than `maxLines` gets a part of its own. Ranges are 1-based lines of the part. */
export const splitDiff = (
  text: string,
  audienceOf: (path: string) => Audience = () => 'code',
  maxLines: number = DIFF_PART_MAX_LINES,
): { parts: DiffPart[]; files: DiffFileRange[] } => {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const chunks: string[][] = []
  for (const line of lines) {
    if (line.startsWith('diff --git ') || chunks.length === 0) chunks.push([])
    chunks.at(-1)?.push(line)
  }
  const parts: DiffPart[] = []
  const files: DiffFileRange[] = []
  for (const audience of AUDIENCES) {
    const own: string[][] = []
    for (const chunk of chunks) {
      const path = chunkPath(chunk)
      if (audienceOf(path) !== audience) continue
      const current = own.at(-1)
      const part = current !== undefined && current.length + chunk.length <= maxLines ? current : []
      if (part !== current) own.push(part)
      files.push({ path, audience, part: partName(audience, own.length - 1), start: part.length + 1, end: part.length + chunk.length })
      part.push(...chunk)
    }
    parts.push(...own.map((part, index) => ({ name: partName(audience, index), text: `${part.join('\n')}\n` })))
  }
  return { parts, files }
}

const pruneOldDiffDirs = (reviewDir: string, keep: string, now: number): void => {
  for (const name of readdirSync(reviewDir)) {
    const dir = join(reviewDir, name)
    if (!name.startsWith(DIFF_DIR_PREFIX) || dir === keep) continue
    if (now - statSync(dir).mtimeMs > DIFF_DIR_MAX_AGE_MS) rmSync(dir, { recursive: true, force: true })
  }
}

/** Writes under the main checkout's `.jig/runs/review/diff-<content hash>/`, so a retry reuses it; removes such folders older than a week. */
export const writeDiffFiles = (root: string, diffArgs: readonly string[], audienceOf?: (path: string) => Audience, now: number = Date.now()): DiffFiles => {
  const result = git(['diff', '--no-color', '--no-ext-diff', ...diffArgs], root)
  if (!result.ok) throw new Error(`git diff failed: ${result.stderr.trim()}`)
  const main = listWorktrees(root)[0]?.path ?? root
  const reviewDir = join(ensureJigDir(main).runs, 'review')
  const dir = join(reviewDir, `${DIFF_DIR_PREFIX}${createHash('sha1').update(result.stdout).digest('hex').slice(0, 12)}`)
  mkdirSync(dir, { recursive: true })
  pruneOldDiffDirs(reviewDir, dir, now)
  const { parts, files } = splitDiff(result.stdout, audienceOf)
  for (const part of parts) writeFileSync(join(dir, part.name), part.text)
  const index = join(dir, 'index.txt')
  writeFileSync(index, files.map((file) => `${file.path}\t${file.part}:${file.start}-${file.end}\n`).join(''))
  const pathOf = (name: string): string => toSlash(join(dir, name))
  const audiences = Object.fromEntries(AUDIENCES.map((audience) => [audience, parts.filter((part) => part.name.startsWith(`${audience}-`)).map((part) => pathOf(part.name))])) as Record<Audience, string[]>
  return { dir: toSlash(dir), index: toSlash(index), parts: parts.map((part) => pathOf(part.name)), audiences }
}
