import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { NativeRules } from '../hook/types'
import { chainFor, expandImports, hasFile, repoRootOf } from './chain'

const CLAUDE_NAMES = ['CLAUDE.md', 'CLAUDE.local.md']
const CODEX_NAMES = ['AGENTS.override.md', 'AGENTS.md']
const OPENCODE_NAMES = ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md']

const within = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

const dirsBetween = (top: string, dir: string): string[] => {
  const dirs: string[] = []
  for (let current = resolve(dir); within(top, current); current = dirname(current)) dirs.unshift(current)
  return dirs
}

const hasAny = (dir: string, names: readonly string[]): boolean => names.some((name) => hasFile(dir, name))

const claudeStart = (launchDir: string): string[] => {
  const claude = chainFor(launchDir, CLAUDE_NAMES)
  if (claude === undefined) return []
  if (claude.rules.length > 0) return claude.rules
  return chainFor(launchDir, ['AGENTS.md'])?.rules ?? []
}

const claudeOnRead = (file: string, launchDir: string): string[] =>
  expandImports(
    dirsBetween(launchDir, dirname(resolve(file))).flatMap((dir) => {
      if (hasAny(dir, CLAUDE_NAMES)) return CLAUDE_NAMES.filter((name) => hasFile(dir, name)).map((name) => join(dir, name))
      return hasFile(dir, 'AGENTS.md') ? [join(dir, 'AGENTS.md')] : []
    }),
  )

const firstPerDir = (launchDir: string, names: readonly string[]): string[] => {
  const root = repoRootOf(launchDir)
  if (root === undefined) return []
  return [root, ...dirsBetween(root, launchDir)].flatMap((dir) => {
    const name = names.find((candidate) => hasFile(dir, candidate))
    return name === undefined ? [] : [join(dir, name)]
  })
}

const opencodeStart = (launchDir: string): string[] => {
  const root = repoRootOf(launchDir) ?? resolve(launchDir)
  const dirs = [root, ...dirsBetween(root, launchDir)]
  for (const name of OPENCODE_NAMES) {
    const files = dirs.filter((dir) => hasFile(dir, name)).map((dir) => join(dir, name))
    if (files.length > 0) return files
  }
  return []
}

const opencodeOnRead = (file: string, launchDir: string): string[] =>
  dirsBetween(launchDir, dirname(resolve(file))).flatMap((dir) => {
    const name = OPENCODE_NAMES.find((candidate) => hasFile(dir, candidate))
    return name === undefined ? [] : [join(dir, name)]
  })

const NO_READ_LOADS = (): string[] => []

export const NATIVE_RULES = {
  claude: { atStart: claudeStart, onRead: claudeOnRead },
  codex: { atStart: (launchDir: string) => firstPerDir(launchDir, CODEX_NAMES), onRead: NO_READ_LOADS },
  opencode: { atStart: opencodeStart, onRead: opencodeOnRead },
  grok: { atStart: (launchDir: string) => chainFor(launchDir)?.rules ?? [], onRead: NO_READ_LOADS },
} satisfies Record<string, NativeRules>
