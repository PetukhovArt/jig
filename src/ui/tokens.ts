import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { UiTokens } from '../core/config-ui'
import { childPath, isObject, Validator } from '../core/validator'
import type { CommandRunner } from './run'
import { hexOf } from './tree'

export interface Token {
  name: string
  value: string
  themes: Record<string, string>
  refs: string[]
}

const MAX_ALIAS_DEPTH = 8
const ALIAS = /^\{([^{}]+)\}$/

export interface SizeToken {
  name: string
  size: number
  refs: string[]
}

interface RawToken {
  name: string
  type: unknown
  value: unknown
  themes: Record<string, unknown>
  refs: string[]
}

const colorValue = (value: unknown): unknown => (isObject(value) && typeof value['hex'] === 'string' ? value['hex'] : value)

const readJigExtension = (validator: Validator, value: unknown, path: string): { themes: Record<string, unknown>; refs: string[] } => {
  const empty = { themes: {}, refs: [] as string[] }
  if (value === undefined) return empty
  const extensions = validator.object(value, path, undefined)
  const jig = extensions?.['jig']
  if (jig === undefined) return empty
  const object = validator.object(jig, childPath(path, 'jig'), ['themes', 'refs'])
  if (object === undefined) return empty
  const themes = object['themes'] === undefined ? {} : (validator.object(object['themes'], childPath(childPath(path, 'jig'), 'themes'), undefined) ?? {})
  const refs = object['refs'] === undefined ? [] : (validator.strings(object['refs'], childPath(childPath(path, 'jig'), 'refs')) ?? [])
  return { themes, refs }
}

const collect = (validator: Validator, value: unknown, names: string[], path: string, out: RawToken[]): void => {
  if (!isObject(value)) {
    validator.report(path, 'expected an object')
    return
  }
  if (Object.hasOwn(value, '$value')) {
    const { themes, refs } = readJigExtension(validator, value['$extensions'], childPath(path, '$extensions'))
    out.push({ name: names.join('.'), type: value['$type'], value: value['$value'], themes, refs })
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$')) continue
    collect(validator, child, [...names, key], childPath(path, key), out)
  }
}

export const parseTokens = (text: string, label: string): { raw: RawToken[]; errors: string[] } => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { raw: [], errors: [`${label}: not JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const validator = new Validator()
  const raw: RawToken[] = []
  collect(validator, value, [], '$', raw)
  return { raw, errors: validator.errors.map((error) => `${label}: ${error}`) }
}

const resolveColor = (value: unknown, byName: ReadonlyMap<string, RawToken>, depth = 0): string | undefined => {
  const plain = colorValue(value)
  if (typeof plain !== 'string') return undefined
  const alias = ALIAS.exec(plain.trim())
  if (alias === null) return hexOf(plain)[0]
  const target = byName.get(alias[1] ?? '')
  return target === undefined || depth >= MAX_ALIAS_DEPTH ? undefined : resolveColor(target.value, byName, depth + 1)
}

export const resolveTokens = (raw: readonly RawToken[]): Token[] => {
  const byName = new Map<string, RawToken>()
  for (const token of raw) if (!byName.has(token.name)) byName.set(token.name, token)
  const tokens: Token[] = []
  for (const token of byName.values()) {
    if (token.type === 'dimension') continue
    const value = resolveColor(token.value, byName)
    if (value === undefined) continue
    const themes: Record<string, string> = {}
    for (const [theme, themed] of Object.entries(token.themes)) {
      const color = resolveColor(themed, byName)
      if (color !== undefined) themes[theme] = color
    }
    tokens.push({ name: token.name, value, themes, refs: token.refs })
  }
  return tokens
}

const resolveSize = (value: unknown, byName: ReadonlyMap<string, RawToken>, depth = 0): number | undefined => {
  if (typeof value === 'number') return value
  if (isObject(value) && typeof value['value'] === 'number' && (value['unit'] === undefined || value['unit'] === 'px')) return value['value']
  if (typeof value !== 'string') return undefined
  const alias = ALIAS.exec(value.trim())
  if (alias !== null) {
    const target = byName.get(alias[1] ?? '')
    return target === undefined || depth >= MAX_ALIAS_DEPTH ? undefined : resolveSize(target.value, byName, depth + 1)
  }
  const plain = /^(\d+(?:\.\d+)?)(px)?$/.exec(value.trim())
  return plain === null ? undefined : Number(plain[1])
}

export const resolveSizeTokens = (raw: readonly RawToken[]): SizeToken[] => {
  const byName = new Map<string, RawToken>()
  for (const token of raw) if (!byName.has(token.name)) byName.set(token.name, token)
  const sizes: SizeToken[] = []
  for (const token of byName.values()) {
    if (token.type !== 'dimension') continue
    const size = resolveSize(token.value, byName)
    if (size !== undefined) sizes.push({ name: token.name, size, refs: token.refs })
  }
  return sizes
}

export const tokenColor = (token: Token, theme: string | undefined): string => (theme === undefined ? token.value : (token.themes[theme] ?? token.value))

export interface LoadedTokens {
  tokens: Token[]
  sizes: SizeToken[]
  errors: string[]
}

export const loadTokens = (root: string, cwd: string, source: UiTokens, extraFiles: readonly string[], run: CommandRunner): LoadedTokens => {
  const raw: RawToken[] = []
  const errors: string[] = []
  const files = extraFiles.length > 0 ? extraFiles.map((file) => resolve(cwd, file)) : source.files.map((file) => resolve(root, file))
  for (const file of files) {
    if (!existsSync(file)) {
      errors.push(`${file}: no such token file`)
      continue
    }
    const parsed = parseTokens(readFileSync(file, 'utf8'), file)
    raw.push(...parsed.raw)
    errors.push(...parsed.errors)
  }
  if (source.command !== undefined && extraFiles.length === 0) {
    const result = run(source.command, root)
    if (result.code !== 0) {
      errors.push(`ui.tokens.command exited ${result.code ?? 'without a code'}: ${(result.error ?? result.stderr).trim().split('\n').at(-1) ?? ''}`)
    } else {
      const parsed = parseTokens(result.stdout, 'ui.tokens.command')
      raw.push(...parsed.raw)
      errors.push(...parsed.errors)
    }
  }
  return { tokens: resolveTokens(raw), sizes: resolveSizeTokens(raw), errors }
}

