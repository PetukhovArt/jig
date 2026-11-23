import { posix } from 'node:path'
import { filesMatching, type Source } from './source'

export interface LocaleDetection {
  names: string[]
  evidence: string[]
}

const LOCALE_DIR = /(?:^|\/)(?:i18n|locales?|langs?|translations?|messages)\//i
const NOT_BUNDLE = /(?:^|\/)[^/]*(?:date|calendar|picker|time)[^/]*\//i
const BUNDLE_FILE = /\.(?:[cm]?[jt]s|json|ya?ml)$/
const CODES = new Set(
  'ru en de fr es it pt zh ja ko uk pl tr ar cs nl sv he hi id vi th kk be bg el fi da no nb hu ro sk sl hr sr lt lv et az ka hy fa ms'.split(' '),
)
const CODE = /^([a-z]{2})(?:[-_][A-Za-z]{2,4})?$/
const STRING_VALUE = /:\s*(['"`])((?:(?!\1)[^\\\n]|\\.){2,})\1/g
const MAX_LOCALES = 6

const codeOf = (path: string): string | undefined => {
  const dir = LOCALE_DIR.exec(path)
  if (dir === null) return undefined
  const [first = '', second] = path.slice(dir.index + dir[0].length).split('/')
  const candidates = second === undefined ? [posix.basename(first, posix.extname(first))] : [first, posix.basename(second, posix.extname(second))]
  return candidates.find((candidate) => {
    const match = CODE.exec(candidate)
    return match !== null && CODES.has(match[1] ?? '')
  })
}

export const detectLocales = (source: Source): LocaleDetection => {
  const totals = new Map<string, { length: number; count: number }>()
  for (const path of filesMatching(source, BUNDLE_FILE)) {
    if (!LOCALE_DIR.test(path) || NOT_BUNDLE.test(path)) continue
    const code = codeOf(path)
    if (code === undefined) continue
    const total = totals.get(code) ?? { length: 0, count: 0 }
    for (const match of source.read(path).matchAll(STRING_VALUE)) {
      total.length += (match[2] ?? '').length
      total.count += 1
    }
    totals.set(code, total)
  }
  const ranked = [...totals]
    .filter(([, total]) => total.count > 0)
    .map(([code, total]) => ({ code, average: total.length / total.count }))
    .sort((a, b) => b.average - a.average || a.code.localeCompare(b.code))
  if (ranked.length < 2 || ranked.length > MAX_LOCALES) {
    return { names: [], evidence: ranked.length > MAX_LOCALES ? [`${ranked.length} locale bundles: too many to be the app languages`] : [] }
  }
  return { names: ranked.map((entry) => entry.code), evidence: ranked.map((entry) => `${entry.code} avg ${entry.average.toFixed(1)} chars`) }
}
