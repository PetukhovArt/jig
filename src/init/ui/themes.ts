import { filesMatching, hasPackage, type Source } from './source'

export interface ThemeDetection {
  names: string[]
  followsSystem: boolean
  evidence: string[]
}

const STYLE_FILE = /\.(?:css|scss|sass|less|vue|svelte|astro|html)$/
const SCRIPT_FILE = /\.(?:vue|svelte|astro|html|[cm]?[jt]sx?)$/
const PLAIN_CSS = /\.(?:css|scss|sass|less)$/
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const CLASS_THEME = /(?:^|[\s,}>+~&])\.(?:(?:vr|theme|is|app|mode)-)?(dark|light)(?![\w-])/gm
const DATA_THEME_SELECTOR = /\[data-theme(?:=['"]?([\w-]+))?/g
const DATA_THEME_ATTRIBUTE = /\sdata-theme=["']([\w-]+)["']/g
const PREFERS_SCHEME = /prefers-color-scheme/
const VUETIFY_THEME = /\b(light|dark)\s*:\s*\{/g
const MUI_MODE = /\bmode\s*:\s*['"](light|dark)['"]/g
const ORDER = ['light', 'dark']

const cssOf = (path: string, text: string): string =>
  PLAIN_CSS.test(path) ? text : [...text.matchAll(STYLE_BLOCK)].map((match) => match[1] ?? '').join('\n')

const collect = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].flatMap((match) => match[1] ?? [])

const ordered = (names: Set<string>): string[] => {
  if (names.has('dark') || names.has('light')) {
    names.add('dark')
    names.add('light')
  }
  const rank = (name: string): number => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length)
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export const detectThemes = (source: Source): ThemeDetection => {
  const names = new Set<string>()
  const evidence = new Set<string>()
  let followsSystem = false
  const add = (found: string[], label: string): void => {
    for (const name of found) names.add(name)
    if (found.length > 0) evidence.add(label)
  }
  const noteSystem = (): void => {
    followsSystem = true
    evidence.add('prefers-color-scheme')
  }
  for (const path of filesMatching(source, STYLE_FILE)) {
    const text = source.read(path)
    const css = cssOf(path, text)
    add(collect(css, CLASS_THEME), 'class .dark/.light')
    add([...collect(css, DATA_THEME_SELECTOR), ...collect(text, DATA_THEME_ATTRIBUTE)], '[data-theme]')
    if (PREFERS_SCHEME.test(css)) noteSystem()
  }
  for (const path of filesMatching(source, SCRIPT_FILE)) {
    const text = source.read(path)
    if (PREFERS_SCHEME.test(text)) noteSystem()
    if (hasPackage(source, 'vuetify') && text.includes('createVuetify')) add(collect(text, VUETIFY_THEME), 'Vuetify theme config')
    if (hasPackage(source, '@mui/material') && text.includes('createTheme')) add(collect(text, MUI_MODE), 'MUI theme mode')
    if (hasPackage(source, 'primevue') && text.includes('darkModeSelector')) add(['light', 'dark'], 'PrimeVue darkModeSelector')
  }
  return { names: names.size === 0 ? ['default'] : ordered(names), followsSystem, evidence: [...evidence] }
}
