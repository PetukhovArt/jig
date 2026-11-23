import { posix } from 'node:path'
import { projectFiles } from '../discover'
import { detectComponents, detectTokens } from './components'
import { detectLocales } from './locales'
import { createSource, filesMatching, hasPackage, hasPackagePrefix, type Source } from './source'
import { detectThemes } from './themes'

type Json = Record<string, unknown>

export interface UiDetection {
  proposal: Json | undefined
  notes: string[]
  questions: string[]
}

const FRAMEWORKS = ['react', 'vue', 'solid-js', 'svelte', 'astro', 'preact', 'lit', '@angular/core', 'vuetify', '@mui/material']
const NATIVE_STACKS = ['@capacitor/core', 'react-native', 'expo', 'nativescript']
const UI_FILE = /\.(?:tsx|jsx|vue|svelte|astro|html)$/
const STYLE_FILE = /\.(?:css|scss|sass|less|vue|svelte|astro|html)$/
const MEDIA_QUERY = /@media[^{]*\(\s*(?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/g
const COARSE = /pointer\s*:\s*coarse/
const PHONE_MODULE = /(?:^|\/)(?:viewport|responsive)\.(?:[cm]?[jt]sx?|css|scss|vue)$/
const PHONE_WIDTH_LIMIT = 768
const DESKTOP_WIDTHS = [1280, 1920]
const PHONE_WIDTHS = [390]

const runtimeOf = (source: Source): 'electron' | 'tauri' | 'browser' => {
  if (hasPackage(source, 'electron')) return 'electron'
  const hasTauriConfig = source.files.some((file) => posix.basename(file) === 'tauri.conf.json')
  return hasPackagePrefix(source, '@tauri-apps/') || hasTauriConfig ? 'tauri' : 'browser'
}

const responsiveEvidence = (source: Source): string[] => {
  const evidence = new Set<string>()
  for (const path of filesMatching(source, STYLE_FILE)) {
    const text = source.read(path)
    for (const match of text.matchAll(MEDIA_QUERY)) {
      if (Number(match[1]) < PHONE_WIDTH_LIMIT) evidence.add('media query below 768px')
    }
    if (COARSE.test(text)) evidence.add('pointer: coarse')
  }
  if (filesMatching(source, PHONE_MODULE).length > 0) evidence.add('viewport/responsive module')
  return [...evidence]
}

const themeSwitch = (name: string, media: boolean): Json => ({
  switch: media ? { media: name } : { act: `TODO: agent-view act that switches the app to the ${name} theme` },
})

const proposeTargets = (source: Source, notes: string[]): Json[] => {
  const runtime = runtimeOf(source)
  const isNativeOnly = hasPackage(source, 'react-native', 'expo', 'nativescript') && !hasPackage(source, 'react-dom')
  const targets: Json[] = []
  if (!isNativeOnly) {
    targets.push({ name: runtime === 'browser' ? 'web' : 'desktop', runtime, widths: DESKTOP_WIDTHS })
    notes.push(`runtime ${runtime}: ${runtime === 'browser' ? 'no tauri or electron dependency' : 'desktop shell dependency'}`)
    const responsive = responsiveEvidence(source)
    const isPhoneApp = runtime === 'browser' ? responsive.length > 0 : responsive.includes('pointer: coarse')
    if (!isPhoneApp && responsive.length > 0) notes.push(`no phone target: the ${runtime} shell shows only ${responsive.join(', ')}, no pointer: coarse`)
    if (isPhoneApp) {
      targets.push({ name: 'phone', runtime: 'browser', widths: PHONE_WIDTHS, input: 'coarse' })
      notes.push(`phone target: ${responsive.join(', ')}`)
    }
  }
  if (hasPackage(source, ...NATIVE_STACKS)) {
    targets.push({ name: 'mobile-app', runtime: 'native', proof: 'manual' })
    notes.push('native app stack: target is proven by hand')
  }
  return targets
}

const proposeThemes = (source: Source, notes: string[], questions: string[]): Json[] => {
  const detected = detectThemes(source)
  const isLightDark = detected.names.every((name) => name === 'light' || name === 'dark')
  const media = detected.followsSystem && isLightDark
  notes.push(`themes ${detected.names.join(', ')}: ${detected.evidence.length > 0 ? detected.evidence.join(', ') : 'no theme signal'}`)
  if (detected.names.length > 1 && !media) {
    questions.push(`ui.themes: which agent-view act switches the app between ${detected.names.join(' and ')}? The proposal holds TODO acts.`)
  }
  return detected.names.map((name) => ({ name, ...(detected.names.length > 1 ? themeSwitch(name, media) : {}) }))
}

const proposeLocales = (source: Source, notes: string[], questions: string[]): Json | undefined => {
  const detected = detectLocales(source)
  if (detected.evidence.length > 0) notes.push(`locales ${detected.names.join(', ') || 'none proposed'}: ${detected.evidence.join('; ')}`)
  if (detected.names.length === 0) return undefined
  questions.push(`ui.locales: which agent-view act or launch string switches the app language? The proposal holds TODO acts.`)
  const list = detected.names.map((name) => ({ name, switch: { act: `TODO: agent-view act that switches the language to ${name}` } }))
  return { list, check: 'one' }
}

const proposeComponents = (source: Source, notes: string[]): Json | undefined => {
  const detected = detectComponents(source)
  if (detected.dirs.length === 0 && Object.keys(detected.map).length === 0) return undefined
  notes.push(`components: dirs ${detected.dirs.join(', ') || 'none'}; ${detected.evidence.join('; ') || 'no wrapper names'}`)
  return {
    ...(detected.dirs.length > 0 ? { dirs: detected.dirs } : {}),
    ...(Object.keys(detected.map).length > 0 ? { map: detected.map } : {}),
  }
}

export const detectUiFrom = (source: Source): UiDetection => {
  const isUi = hasPackage(source, ...FRAMEWORKS) || filesMatching(source, UI_FILE).length > 0
  if (!isUi) return { proposal: undefined, notes: ['no UI framework dependency and no component or HTML file: no ui key proposed'], questions: [] }
  const notes: string[] = []
  const questions: string[] = []
  const targets = proposeTargets(source, notes)
  const themes = proposeThemes(source, notes, questions)
  const locales = proposeLocales(source, notes, questions)
  const components = proposeComponents(source, notes)
  const tokens = detectTokens(source)
  if (tokens.length > 0) notes.push(`tokens: ${tokens.join(', ')}`)
  const proposal: Json = {
    targets,
    themes,
    ...(locales === undefined ? {} : { locales }),
    ...(components === undefined ? {} : { components }),
    ...(tokens.length > 0 ? { tokens } : {}),
  }
  return { proposal, notes, questions }
}

export const detectUi = (projectRoot: string, packages: readonly string[]): UiDetection =>
  detectUiFrom(createSource(projectRoot, projectFiles(projectRoot), packages))
