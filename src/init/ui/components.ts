import { posix } from 'node:path'
import { filesMatching, hasPackage, type Source } from './source'

export interface ComponentsDetection {
  dirs: string[]
  map: Record<string, string>
  evidence: string[]
}

const COMPONENT_DIRS = [
  /^((?:[^/]+\/){0,2}src\/shared\/ui)\//,
  /^((?:[^/]+\/){0,2}src\/components\/ui)\//,
  /^((?:[^/]+\/){0,2}components\/ui)\//,
  /^(packages\/(?![^/]*(?:token|config))[^/]*(?:ui|kit|design)[^/]*\/src)\//,
]
const FALLBACK_DIR = /^((?:[^/]+\/){0,2}src\/components)\//
const WRAPPER_FILE = /\.(?:tsx|jsx|vue|svelte|astro|[cm]?[jt]s)$/
const VENDORED_WIDGET = /date|calendar|picker/i
const PREFIX = '(?:ui|v|app|base|vr|a)?'

interface Wrapper {
  tag: string
  name: RegExp
  vuetify?: string
  mui?: string
  primevue?: string
}

const WRAPPERS: Wrapper[] = [
  { tag: 'button', name: new RegExp(`^${PREFIX}(?:button|btn)$`), vuetify: 'v-btn', mui: 'Button', primevue: 'Button' },
  { tag: 'input', name: new RegExp(`^${PREFIX}(?:textfield|input|textinput|inputtext)$`), vuetify: 'v-text-field', mui: 'TextField', primevue: 'InputText' },
  { tag: 'select', name: new RegExp(`^${PREFIX}select$`), vuetify: 'v-select', mui: 'Select', primevue: 'Select' },
  { tag: 'textarea', name: new RegExp(`^${PREFIX}textarea$`), vuetify: 'v-textarea', primevue: 'Textarea' },
]

const TOKEN_FILE = /\.(?:css|scss|ts|js|json)$/
const MAX_TOKEN_PATHS = 3

const normalized = (name: string): string => name.toLowerCase().replace(/[-_]/g, '')

const pascal = (name: string): string =>
  /[A-Z]/.test(name) ? name : name.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')

const namesIn = (path: string, dir: string): string[] => {
  const parts = path.slice(dir.length + 1).split('/')
  const file = posix.basename(parts.pop() ?? '', posix.extname(path))
  return [...(file === 'index' ? [] : [file]), ...parts.reverse()].filter((part) => part !== '')
}

const wrapperName = (wrapper: Wrapper, files: string[], dirs: string[]): string | undefined => {
  for (const file of files) {
    const dir = dirs.find((candidate) => file.startsWith(`${candidate}/`))
    if (dir === undefined) continue
    const name = namesIn(file, dir).find((candidate) => wrapper.name.test(normalized(candidate)))
    if (name !== undefined) return pascal(name)
  }
  return undefined
}

const libraryName = (source: Source, wrapper: Wrapper): string | undefined => {
  if (hasPackage(source, 'vuetify')) return wrapper.vuetify
  if (hasPackage(source, '@mui/material')) return wrapper.mui
  if (hasPackage(source, 'primevue')) return wrapper.primevue
  return undefined
}

const detectDirs = (source: Source): string[] => {
  const dirs = new Set<string>()
  for (const file of source.files) {
    for (const pattern of COMPONENT_DIRS) {
      const dir = pattern.exec(file)?.[1]
      if (dir !== undefined) dirs.add(dir)
    }
  }
  if (dirs.size > 0) return [...dirs].sort()
  const fallback = new Set(source.files.flatMap((file) => FALLBACK_DIR.exec(file)?.[1] ?? []))
  return [...fallback].sort()
}

export const detectComponents = (source: Source): ComponentsDetection => {
  const dirs = detectDirs(source)
  const files = filesMatching(source, WRAPPER_FILE).filter((file) => !VENDORED_WIDGET.test(file)).sort((a, b) => a.length - b.length || a.localeCompare(b))
  const map: Record<string, string> = {}
  const evidence: string[] = []
  for (const wrapper of WRAPPERS) {
    const own = wrapperName(wrapper, files, dirs)
    const value = own ?? libraryName(source, wrapper)
    if (value === undefined) continue
    map[wrapper.tag] = value
    evidence.push(`${wrapper.tag} -> ${value} (${own === undefined ? 'library' : 'project wrapper'})`)
  }
  return { dirs, map, evidence }
}

export const detectTokens = (source: Source): string[] => {
  const found = new Set<string>()
  for (const file of filesMatching(source, TOKEN_FILE)) {
    const parts = file.split('/')
    const index = parts.slice(0, -1).findIndex((part) => part === 'tokens' || part.endsWith('-tokens'))
    if (index >= 0) found.add(parts.slice(0, index + 1).join('/'))
    else if (/^tokens\.(?:css|scss|json)$/.test(posix.basename(file))) found.add(file)
  }
  return [...found].sort().slice(0, MAX_TOKEN_PATHS)
}
