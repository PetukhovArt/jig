import { readdirSync, readFileSync, statSync, type Stats } from 'node:fs'
import { join, posix } from 'node:path'
import { matchGlob } from '../../core/glob'
import { hexOf, normHex } from './export'

export interface CodeFile {
  file: string
  lines: string[]
}

export interface CodeColors {
  colors: Map<string, string[]>
  tokenCount: number
}

export interface TypographyRole {
  sample: string
  file: string | null
  key: string
  raw: string
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|css|scss|less|json|cs|xaml|kt|swift|dart)$/
const TEST_PATH = /^_?_?tests?_?_?$|\.(test|spec|stories)\.[a-z]+$/
const GLOB_CHARS = /[*?{[]/

export const isTestFile = (file: string): boolean => file.split(/[\\/]/).some((part) => TEST_PATH.test(part))

export const isSourceFile = (file: string): boolean => SOURCE_EXT.test(file)

const statOrUndefined = (path: string): Stats | undefined => statSync(path, { throwIfNoEntry: false })

export const loadCode = (root: string, paths: readonly string[], skip: (message: string) => void): CodeFile[] => {
  const files: string[] = []
  const walk = (path: string): void => {
    const stat = statOrUndefined(join(root, path))
    if (stat === undefined) {
      skip(`skip ${path}: not found`)
      return
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(join(root, path))) {
        if (entry !== 'node_modules' && !entry.startsWith('.') && !TEST_PATH.test(entry)) walk(posix.join(path, entry))
      }
    } else if (SOURCE_EXT.test(path) && !TEST_PATH.test(posix.basename(path))) {
      files.push(path)
    }
  }
  paths.forEach((path) => walk(posix.normalize(path.replace(/\\/g, '/'))))
  return files.map((file) => ({ file, lines: readFileSync(join(root, file), 'utf8').split(/\r?\n/) }))
}

const STYLE_FILE = /\.(css|scss|less)$/

const tokenFilesOf = (root: string, entry: string, skip: (message: string) => void): string[] => {
  const base = entry.replace(/\\/g, '/')
  const found: string[] = []
  const isGlob = GLOB_CHARS.test(base)
  const prefix = isGlob ? base.split('/').slice(0, base.split('/').findIndex((part) => GLOB_CHARS.test(part))).join('/') : base
  const walk = (path: string): void => {
    const stat = statOrUndefined(join(root, path))
    if (stat === undefined) {
      if (!isGlob || path !== prefix) skip(`skip ${path}: not found`)
      return
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(join(root, path))) {
        if (name !== 'node_modules' && name !== '.git') walk(path === '' ? name : posix.join(path, name))
      }
    } else if (STYLE_FILE.test(path) && (!isGlob || matchGlob(path, base))) {
      found.push(path)
    }
  }
  walk(prefix)
  return found
}

const loadTokenDefs = (root: string, entries: readonly string[], skip: (message: string) => void): Map<string, string> => {
  const defs = new Map<string, string>()
  for (const entry of entries) {
    for (const file of tokenFilesOf(root, entry, skip)) {
      for (const match of readFileSync(join(root, file), 'utf8').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const name = match[1] ?? ''
        if (!defs.has(name)) defs.set(name, (match[2] ?? '').trim())
      }
    }
  }
  return defs
}

const resolveToken = (defs: ReadonlyMap<string, string>, name: string, seen = new Set<string>()): string | null => {
  const value = defs.get(name)
  if (seen.has(name) || value === undefined) return null
  seen.add(name)
  const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value)
  if (reference !== null) {
    const resolved = resolveToken(defs, reference[1] ?? '', seen)
    if (resolved !== null) return resolved
    return reference[2] === undefined ? null : (hexOf(reference[2])[0]?.split(' ')[0] ?? null)
  }
  return hexOf(value)[0]?.split(' ')[0] ?? null
}

export const location = (file: string, index: number): string => `${file}:${index + 1}`

export const collectCodeColors = (root: string, code: readonly CodeFile[], tokens: readonly string[], skip: (message: string) => void): CodeColors => {
  const defs = loadTokenDefs(root, tokens, skip)
  const colors = new Map<string, string[]>()
  const add = (hex: string, where: string): void => {
    const places = colors.get(hex) ?? []
    places.push(where)
    colors.set(hex, places)
  }
  for (const { file, lines } of code) {
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/(?:#|\b0x)([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
        const digits = match[1] ?? ''
        if (match[0].startsWith('#') && digits.length === 3 && /^\d+$/.test(digits)) continue
        add(normHex(digits), location(file, index))
      }
      if (defs.size === 0) return
      const names = [
        ...[...line.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? ''),
        ...[...line.matchAll(/['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/gi)].map((match) => `--${(match[1] ?? '').replace(/\./g, '-')}`),
      ]
      for (const name of names) {
        const hex = resolveToken(defs, name)
        if (hex !== null) add(hex, `${location(file, index)} (${name})`)
      }
    })
  }
  return { colors, tokenCount: defs.size }
}

export const parseRoles = (roles: readonly string[], normalize: (text: string) => string): TypographyRole[] =>
  roles.map((raw) => {
    const at = raw.lastIndexOf('=')
    const target = raw.slice(at + 1)
    const colon = target.lastIndexOf(':')
    return {
      sample: normalize(raw.slice(0, at)),
      file: colon > 0 ? target.slice(0, colon).replace(/\\/g, '/') : null,
      key: colon > 0 ? target.slice(colon + 1) : target,
      raw,
    }
  })

const declarationMentionsFont = (lines: readonly string[], index: number): boolean => {
  for (let at = index; at >= 0; at--) {
    const line = lines[at] ?? ''
    if (/font/i.test(line)) return true
    if (at < index && /^(export\b|const\b|let\b|function\b|class\b|\}|[A-Za-z_$])/.test(line)) return false
  }
  return false
}

export interface SizeHit {
  size: number
  where: string
}

export const sizesInCode = (code: readonly CodeFile[], role: TypographyRole): SizeHit[] => {
  const hits: SizeHit[] = []
  const esc = role.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const direct = new RegExp(`(?:^\\s*|[{,]\\s*|\\b(?:const|let|var|readonly|static)\\s+)${esc}\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)\\b`)
  const block = new RegExp(`\\b${esc}\\s*:\\s*\\{\\s*$|\\b${esc}\\s*:\\s*\\{(?![^}]*\\})`)
  for (const { file, lines } of code) {
    if (role.file !== null && !file.endsWith(role.file)) continue
    lines.forEach((line, index) => {
      if (!declarationMentionsFont(lines, index)) return
      for (const match of line.matchAll(new RegExp(direct, 'g'))) hits.push({ size: Number(match[1]), where: location(file, index) })
      if (!block.test(line)) return
      for (let at = index + 1; at < Math.min(lines.length, index + 10); at++) {
        const next = lines[at] ?? ''
        const preset = /\bdefault\s*:\s*(\d+(?:\.\d+)?)\b/.exec(next)
        if (preset !== null) {
          hits.push({ size: Number(preset[1]), where: location(file, at) })
          break
        }
        if (/^\s*\},?\s*$/.test(next)) break
      }
    })
  }
  return hits
}
