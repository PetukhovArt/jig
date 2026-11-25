import { readdirSync, statSync, type Stats } from 'node:fs'
import { join, posix } from 'node:path'
import { readText } from '../text'
import { tokenColor, type SizeToken, type Token } from '../tokens'
import { normHex } from '../tree'

export interface CodeFile {
  file: string
  lines: string[]
}

export interface CodeColors {
  colors: Map<string, string[]>
}

export interface TypographyRole {
  sample: string
  file: string | null
  key: string
  raw: string
}

const TEST_PATH = /^_?_?tests?_?_?$|\.(test|spec|stories)\.[a-z]+$/

export const isTestFile = (file: string): boolean => file.split(/[\\/]/).some((part) => TEST_PATH.test(part))

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
    } else if (!TEST_PATH.test(posix.basename(path))) {
      files.push(path)
    }
  }
  paths.forEach((path) => walk(posix.normalize(path.replace(/\\/g, '/'))))
  return files.flatMap((file) => {
    const text = readText(join(root, file))
    return text === undefined ? [] : [{ file, lines: text.split(/\r?\n/) }]
  })
}

export const location = (file: string, index: number): string => `${file}:${index + 1}`

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const refPattern = (ref: string): RegExp => new RegExp(`(?<![\\w-])${escapeRegExp(ref)}(?![\\w-]|\\.\\w)`)

export const collectCodeColors = (code: readonly CodeFile[], tokens: readonly Token[], theme: string | undefined): CodeColors => {
  const lookups = tokens.flatMap((token) => token.refs.map((ref) => ({ ref, pattern: refPattern(ref), hex: tokenColor(token, theme).split(' ')[0] ?? '' })))
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
      for (const { ref, pattern, hex } of lookups) {
        if (pattern.test(line)) add(hex, `${location(file, index)} (${ref})`)
      }
    })
  }
  return { colors }
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

const sizeTokenHits = (code: readonly CodeFile[], role: TypographyRole, sizes: readonly SizeToken[]): SizeHit[] => {
  const token = sizes.find((candidate) => candidate.name === role.key || candidate.refs.includes(role.key))
  if (token === undefined) return []
  const names = [...new Set([role.key, ...token.refs])]
  const hits: SizeHit[] = []
  for (const { file, lines } of code) {
    if (role.file !== null && !file.endsWith(role.file)) continue
    lines.forEach((line, index) => {
      if (names.some((name) => line.includes(name))) hits.push({ size: token.size, where: `${location(file, index)} (token ${token.name})` })
    })
  }
  return hits
}

export const sizesInCode = (code: readonly CodeFile[], role: TypographyRole, sizes: readonly SizeToken[] = []): SizeHit[] => {
  const viaToken = sizeTokenHits(code, role, sizes)
  if (viaToken.length > 0) return viaToken
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
