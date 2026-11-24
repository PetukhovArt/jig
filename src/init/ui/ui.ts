import { posix } from 'node:path'
import { projectFiles } from '../discover'

type Json = Record<string, unknown>

export interface UiDetection {
  proposal: Json | undefined
  notes: string[]
  questions: string[]
}

const FRAMEWORKS = ['react', 'vue', 'solid-js', 'svelte', 'astro', 'preact', 'lit', '@angular/core']
const NATIVE_STACKS = ['@capacitor/core', 'react-native', 'expo', 'nativescript']
const DESKTOP_WIDTHS = [1280, 1920]

const runtimeOf = (packages: ReadonlySet<string>, files: readonly string[]): 'electron' | 'tauri' | 'browser' => {
  if (packages.has('electron')) return 'electron'
  const hasTauriConfig = files.some((file) => posix.basename(file) === 'tauri.conf.json')
  return [...packages].some((name) => name.startsWith('@tauri-apps/')) || hasTauriConfig ? 'tauri' : 'browser'
}

const proposeTargets = (packages: ReadonlySet<string>, files: readonly string[], notes: string[]): Json[] => {
  const has = (...names: string[]): boolean => names.some((name) => packages.has(name))
  const runtime = runtimeOf(packages, files)
  const isNativeOnly = has('react-native', 'expo', 'nativescript') && !has('react-dom')
  const targets: Json[] = []
  if (!isNativeOnly) {
    targets.push({ name: runtime === 'browser' ? 'web' : 'desktop', runtime, widths: DESKTOP_WIDTHS })
    notes.push(`runtime ${runtime}: ${runtime === 'browser' ? 'no tauri or electron dependency' : 'desktop shell dependency'}`)
  }
  if (has(...NATIVE_STACKS)) {
    targets.push({ name: 'mobile-app', runtime: 'native', proof: 'manual' })
    notes.push('native app stack: target is proven by hand')
  }
  return targets
}

export const detectUiFrom = (packages: ReadonlySet<string>, files: readonly string[]): UiDetection => {
  if (![...FRAMEWORKS, ...NATIVE_STACKS].some((name) => packages.has(name))) {
    return { proposal: undefined, notes: ['no UI framework dependency: no ui key proposed'], questions: [] }
  }
  const notes: string[] = []
  const targets = proposeTargets(packages, files, notes)
  const questions = [
    'ui.targets: does the app also run on a phone or another viewport class? Add a target with widths and input: coarse.',
    'ui.themes: name every theme the app has, and for more than one, how the app switches between them (switch: media, act or launch). The proposal holds one default theme.',
    'ui.locales: which languages must be proven, longest texts first, and how the app switches its language?',
    'ui.components: where do the shared components live (dirs), and which component replaces each raw element (map)?',
    'ui.tokens: where is the design token table (DTCG JSON), or which command prints it?',
  ]
  return { proposal: { targets, themes: [{ name: 'default' }] }, notes, questions }
}

export const detectUi = (projectRoot: string, packages: readonly string[]): UiDetection => detectUiFrom(new Set(packages), projectFiles(projectRoot))
