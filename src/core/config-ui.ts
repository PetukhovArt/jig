import { childPath, required, Validator, type Json } from './validator'

export const UI_RUNTIMES = ['electron', 'tauri', 'browser', 'native'] as const
export type UiRuntime = (typeof UI_RUNTIMES)[number]

export const UI_INPUTS = ['fine', 'coarse'] as const
export type UiInput = (typeof UI_INPUTS)[number]

export const UI_PROOFS = ['auto', 'manual'] as const
export type UiProof = (typeof UI_PROOFS)[number]

export const UI_LOCALE_CHECKS = ['one', 'all'] as const
export type UiLocaleCheck = (typeof UI_LOCALE_CHECKS)[number]

export const SWITCH_KINDS = ['media', 'act', 'launch'] as const
export type SwitchKind = (typeof SWITCH_KINDS)[number]
export type UiSwitch = Partial<Record<SwitchKind, string>>

export interface UiTarget {
  name: string
  runtime: UiRuntime
  proof: UiProof
  widths: number[]
  height?: number
  minWidth?: number
  input?: UiInput
}

export interface UiVariant {
  name: string
  switch?: UiSwitch
}

export interface UiLocales {
  list: UiVariant[]
  check: UiLocaleCheck
}

export interface UiComponents {
  dirs: string[]
  files: string[]
  map: Record<string, string>
}

export interface UiConfig {
  targets: UiTarget[]
  themes: UiVariant[]
  locales?: UiLocales
  components?: UiComponents
  tokens: string[]
}

export const DEFAULT_COMPONENT_FILES = '**/*.{tsx,jsx,vue,svelte,astro}'

const UI_KEYS = ['targets', 'themes', 'locales', 'components', 'tokens'] as const
const TARGET_KEYS = ['name', 'runtime', 'widths', 'height', 'minWidth', 'input', 'proof'] as const
const VARIANT_KEYS = ['name', 'switch'] as const
const LOCALES_KEYS = ['list', 'check'] as const
const COMPONENTS_KEYS = ['dirs', 'files', 'map'] as const
const MAX_PIXELS = 100_000

const readGlobs = (validator: Validator, value: unknown, path: string): string[] | undefined =>
  typeof value === 'string' ? [value] : validator.strings(value, path)

const readName = (validator: Validator, value: unknown, path: string): string | undefined => {
  const name = validator.string(value, path)
  if (name !== undefined && name.trim() === '') return validator.report(path, 'is empty')
  return name
}

const readSwitch = (validator: Validator, value: unknown, path: string, allowed: readonly SwitchKind[]): UiSwitch | undefined => {
  const object = validator.object(value, path, SWITCH_KINDS)
  if (object === undefined) return undefined
  const given = SWITCH_KINDS.filter((kind) => Object.hasOwn(object, kind))
  if (given.length !== 1) return validator.report(path, `expected exactly one of ${allowed.join(', ')}`)
  const kind = given[0] as SwitchKind
  if (!allowed.includes(kind)) return validator.report(childPath(path, kind), `is not available here, expected ${allowed.join(' or ')}`)
  const text = readName(validator, object[kind], childPath(path, kind))
  return text === undefined ? undefined : { [kind]: text }
}

const readNamedList = <T extends { name: string }>(
  validator: Validator,
  value: unknown,
  path: string,
  readEntry: (entry: unknown, entryPath: string, size: number) => T | undefined,
): T[] | undefined => {
  if (!Array.isArray(value)) return validator.report(path, 'expected an array')
  if (value.length === 0) return validator.report(path, 'expected at least one entry')
  const entries: T[] = []
  value.forEach((raw, index) => {
    const entryPath = childPath(path, index)
    const entry = readEntry(raw, entryPath, value.length)
    if (entry === undefined) return
    if (entries.some((other) => other.name === entry.name)) {
      validator.report(childPath(entryPath, 'name'), `duplicate name ${entry.name}`)
      return
    }
    entries.push(entry)
  })
  return entries
}

const readTarget = (validator: Validator, value: unknown, path: string): UiTarget | undefined => {
  const object = validator.object(value, path, TARGET_KEYS)
  if (object === undefined || !required(validator, object, path, ['name', 'runtime'])) return undefined
  const before = validator.errors.length
  const at = (key: string): string => childPath(path, key)
  const name = readName(validator, object['name'], at('name'))
  const runtime = validator.oneOf(object['runtime'], at('runtime'), UI_RUNTIMES)
  const isNative = runtime === 'native'
  const proof = object['proof'] === undefined ? undefined : validator.oneOf(object['proof'], at('proof'), UI_PROOFS)
  if (isNative && proof === 'auto') validator.report(at('proof'), 'a native target is proven by hand: expected manual')
  let widths: number[] = []
  if (object['widths'] === undefined) {
    if (!isNative && runtime !== undefined) validator.report(at('widths'), 'is required')
  } else if (!Array.isArray(object['widths']) || (object['widths'].length === 0 && !isNative)) {
    validator.report(at('widths'), 'expected a non-empty array of integers')
  } else {
    widths = object['widths'].flatMap((item, index) => validator.integer(item, childPath(at('widths'), index), 1, MAX_PIXELS) ?? [])
  }
  const height = object['height'] === undefined ? undefined : validator.integer(object['height'], at('height'), 1, MAX_PIXELS)
  const minWidth = object['minWidth'] === undefined ? undefined : validator.integer(object['minWidth'], at('minWidth'), 1, MAX_PIXELS)
  const input = object['input'] === undefined ? undefined : validator.oneOf(object['input'], at('input'), UI_INPUTS)
  if (minWidth !== undefined) {
    widths.forEach((width, index) => {
      if (width < minWidth) validator.report(childPath(at('widths'), index), `${width} is below minWidth ${minWidth}`)
    })
  }
  if (validator.errors.length > before || name === undefined || runtime === undefined) return undefined
  return {
    name,
    runtime,
    proof: isNative ? 'manual' : (proof ?? 'auto'),
    widths,
    ...(height === undefined ? {} : { height }),
    ...(minWidth === undefined ? {} : { minWidth }),
    ...(input === undefined ? {} : { input }),
  }
}

const readVariant =
  (validator: Validator, allowed: readonly SwitchKind[]) =>
  (value: unknown, path: string, size: number): UiVariant | undefined => {
    const object = validator.object(value, path, VARIANT_KEYS)
    if (object === undefined || !required(validator, object, path, ['name'])) return undefined
    const before = validator.errors.length
    const name = readName(validator, object['name'], childPath(path, 'name'))
    const hasSwitch = object['switch'] !== undefined
    if (!hasSwitch && size > 1) validator.report(childPath(path, 'switch'), 'is required when the list has more than one entry')
    const switchTo = hasSwitch ? readSwitch(validator, object['switch'], childPath(path, 'switch'), allowed) : undefined
    if (validator.errors.length > before || name === undefined) return undefined
    return { name, ...(switchTo === undefined ? {} : { switch: switchTo }) }
  }

const readLocales = (validator: Validator, value: unknown, path: string): UiLocales | undefined => {
  const object = validator.object(value, path, LOCALES_KEYS)
  if (object === undefined || !required(validator, object, path, ['list'])) return undefined
  const list = readNamedList(validator, object['list'], childPath(path, 'list'), readVariant(validator, ['act', 'launch']))
  const check = object['check'] === undefined ? 'one' : validator.oneOf(object['check'], childPath(path, 'check'), UI_LOCALE_CHECKS)
  return list === undefined || check === undefined ? undefined : { list, check }
}

const readMap = (validator: Validator, value: unknown, path: string): Record<string, string> | undefined => {
  const object = validator.object(value, path, undefined)
  if (object === undefined) return undefined
  const map: Record<string, string> = {}
  for (const [key, entry] of Object.entries(object)) {
    const target = readName(validator, entry, childPath(path, key))
    if (target !== undefined) map[key] = target
  }
  return map
}

const readComponents = (validator: Validator, value: unknown, path: string): UiComponents | undefined => {
  const object: Json | undefined = validator.object(value, path, COMPONENTS_KEYS)
  if (object === undefined) return undefined
  const dirs = object['dirs'] === undefined ? [] : (validator.strings(object['dirs'], childPath(path, 'dirs')) ?? [])
  const files = object['files'] === undefined ? [DEFAULT_COMPONENT_FILES] : (readGlobs(validator, object['files'], childPath(path, 'files')) ?? [])
  const map = object['map'] === undefined ? {} : (readMap(validator, object['map'], childPath(path, 'map')) ?? {})
  return { dirs, files, map }
}

export const readUi = (validator: Validator, value: unknown): UiConfig | undefined => {
  const path = '$.ui'
  const object = validator.object(value, path, UI_KEYS)
  if (object === undefined || !required(validator, object, path, ['targets', 'themes'])) return undefined
  const at = (key: string): string => childPath(path, key)
  const targets = readNamedList(validator, object['targets'], at('targets'), (entry, entryPath) => readTarget(validator, entry, entryPath))
  const themes = readNamedList(validator, object['themes'], at('themes'), readVariant(validator, SWITCH_KINDS))
  const locales = object['locales'] === undefined ? undefined : readLocales(validator, object['locales'], at('locales'))
  const components = object['components'] === undefined ? undefined : readComponents(validator, object['components'], at('components'))
  const tokens = object['tokens'] === undefined ? [] : (readGlobs(validator, object['tokens'], at('tokens')) ?? [])
  if (targets === undefined || themes === undefined) return undefined
  return { targets, themes, ...(locales === undefined ? {} : { locales }), ...(components === undefined ? {} : { components }), tokens }
}
