import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { toSlash } from '../core/paths'

export const RULE_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md']

const GLOSSARY = /glossary/i
const GLOSSARY_MAP = /map/i
const IMPORT = /(?:^|\s)@([^\s`'"()<>]+\.md)\b/g
const MAX_IMPORT_DEPTH = 5

export interface Glossary {
  scope: string
  path: string
}

export interface Chain {
  repoRoot: string
  rules: string[]
  glossary?: Glossary
}

const entriesOf = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export const hasFile = (dir: string, name: string): boolean => entriesOf(dir).includes(name)

const isDirectory = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true

export const repoRootOf = (dir: string): string | undefined => {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (lstatSync(join(current, '.git'), { throwIfNoEntry: false }) !== undefined) return current
    if (dirname(current) === current) return undefined
  }
}

const dirsFromRoot = (root: string, dir: string): string[] => {
  const rel = relative(root, dir)
  if (rel.startsWith('..') || isAbsolute(rel)) return [root]
  const parts = rel === '' ? [] : rel.split(/[\\/]/)
  return [root, ...parts.map((_, index) => join(root, ...parts.slice(0, index + 1)))]
}

const readText = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const homeDir = (): string => process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''

const importsOf = (file: string): string[] =>
  [...readText(file).matchAll(IMPORT)]
    .map((match) => match[1] ?? '')
    .map((ref) => (ref.startsWith('~/') ? join(homeDir(), ref.slice(2)) : resolve(dirname(file), ref)))
    .filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true)

export const pathKey = (path: string): string => {
  const slash = toSlash(resolve(path))
  return process.platform === 'win32' ? slash.toLowerCase() : slash
}

const withImports = (file: string, out: string[], seen: Set<string>, depth: number): void => {
  const key = pathKey(file)
  if (seen.has(key)) return
  seen.add(key)
  out.push(file)
  if (depth >= MAX_IMPORT_DEPTH) return
  for (const imported of importsOf(file)) withImports(imported, out, seen, depth + 1)
}

export const expandImports = (files: readonly string[]): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const file of files) withImports(file, out, seen, 0)
  return out
}

const glossaryIn = (dir: string): string | undefined => {
  const name = entriesOf(dir).filter((entry) => entry.toLowerCase().endsWith('.md') && GLOSSARY.test(entry) && !GLOSSARY_MAP.test(entry)).sort()[0]
  return name === undefined ? undefined : join(dir, name)
}

const nearestGlossary = (dirs: readonly string[]): Glossary | undefined => {
  for (const dir of [...dirs].reverse()) {
    const path = glossaryIn(dir)
    if (path !== undefined) return { scope: dir, path }
  }
  return undefined
}

export const chainFor = (target: string, names: readonly string[] = RULE_FILES): Chain | undefined => {
  const absolute = resolve(target)
  const dir = isDirectory(absolute) ? absolute : dirname(absolute)
  const repoRoot = repoRootOf(dir)
  if (repoRoot === undefined) return undefined
  const dirs = dirsFromRoot(repoRoot, dir)
  const rules: string[] = []
  const seen = new Set<string>()
  for (const current of dirs) {
    const entries = entriesOf(current)
    for (const name of names) {
      if (entries.includes(name)) withImports(join(current, name), rules, seen, 0)
    }
  }
  const glossary = nearestGlossary(dirs)
  return glossary === undefined ? { repoRoot, rules } : { repoRoot, rules, glossary }
}

export const renderRules = (files: readonly string[]): string =>
  files.map((file) => `--- ${toSlash(file)} ---\n${readText(file).trimEnd()}`).join('\n\n')

export const renderGlossary = (glossary: Glossary): string =>
  `Glossary for ${toSlash(glossary.scope)}: ${toSlash(glossary.path)}. Before you name a new field, type, prop or term there, read it: take the term it defines, never one of its _Avoid_ words.`
