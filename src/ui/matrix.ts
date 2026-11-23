import type { UiConfig, UiInput, UiLocaleCheck, UiRuntime, UiSwitch } from '../core/config-ui'

export interface Combo {
  target: string
  runtime: UiRuntime
  width: number
  height?: number
  input?: UiInput
  theme: string
  themeSwitch?: UiSwitch
  locale?: string
  localeSwitch?: UiSwitch
}

export interface ManualTarget {
  name: string
  runtime: UiRuntime
  widths: number[]
}

export interface Matrix {
  locales: UiLocaleCheck
  combos: Combo[]
  manual: ManualTarget[]
}

export const buildMatrix = (ui: UiConfig, localeCheck?: UiLocaleCheck): Matrix => {
  const check = localeCheck ?? ui.locales?.check ?? 'one'
  const list = ui.locales?.list ?? []
  const locales = check === 'all' ? list : list.slice(0, 1)
  const combos: Combo[] = []
  const manual: ManualTarget[] = []
  for (const target of ui.targets) {
    if (target.proof === 'manual') {
      manual.push({ name: target.name, runtime: target.runtime, widths: target.widths })
      continue
    }
    for (const width of target.widths) {
      for (const theme of ui.themes) {
        for (const locale of locales.length > 0 ? locales : [undefined]) {
          combos.push({
            target: target.name,
            runtime: target.runtime,
            width,
            ...(target.height === undefined ? {} : { height: target.height }),
            ...(target.input === undefined ? {} : { input: target.input }),
            theme: theme.name,
            ...(theme.switch === undefined ? {} : { themeSwitch: theme.switch }),
            ...(locale === undefined ? {} : { locale: locale.name }),
            ...(locale?.switch === undefined ? {} : { localeSwitch: locale.switch }),
          })
        }
      }
    }
  }
  return { locales: check, combos, manual }
}

export const describeSwitch = (value: UiSwitch | undefined): string => {
  const entry = Object.entries(value ?? {})[0]
  return entry === undefined ? 'current' : `${entry[0]} ${entry[1]}`
}

const comboLine = (combo: Combo): string => {
  const size = `${combo.width}${combo.height === undefined ? '' : `x${combo.height}`}`
  const parts = [
    combo.target.padEnd(10),
    size.padEnd(9),
    combo.input ?? '-',
    `theme ${combo.theme} (${describeSwitch(combo.themeSwitch)})`,
    ...(combo.locale === undefined ? [] : [`locale ${combo.locale} (${describeSwitch(combo.localeSwitch)})`]),
  ]
  return parts.join('  ')
}

export const formatMatrix = (matrix: Matrix): string[] => {
  const lines = [`${matrix.combos.length} combos to prove (locales: ${matrix.locales === 'all' ? 'all' : 'one, the first listed'})`, ...matrix.combos.map(comboLine)]
  if (matrix.manual.length > 0) {
    lines.push('', 'manual targets (the user proves them, jig cannot):')
    lines.push(...matrix.manual.map((target) => `  ${target.name}  ${target.runtime}${target.widths.length > 0 ? `  ${target.widths.join(', ')}` : ''}`))
  }
  return lines
}
