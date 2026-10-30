import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../core/git'
import { importSpecifiers, makeResolver } from './partition'

export interface Site {
  kind: string
  pattern: RegExp
}

const SCRIPT: readonly Site[] = [
  { kind: 'store', pattern: /\b(?:defineStore|createStore|createSlice|configureStore|writable|readable)\s*\(|new\s+Vuex\.Store\b/ },
  { kind: 'store-use', pattern: /\buse\w*Store\s*\(|\bstoreToRefs\s*\(|\.\$patch\s*\(|\.(?:commit|dispatch)\s*\(\s*['"`]/ },
  { kind: 'watch', pattern: /\b(?:watch|watchEffect|watchPostEffect|watchSyncEffect|computed|useEffect|useLayoutEffect|useMemo)\s*\(/ },
  { kind: 'lifecycle', pattern: /\b(?:onMounted|onBeforeMount|onUnmounted|onBeforeUnmount|onActivated|onDeactivated|onUpdated|onScopeDispose)\s*\(/ },
  { kind: 'ipc', pattern: /\bipc(?:Main|Renderer)\.\w+\s*\(|\bcontextBridge\.\w+|\bwebContents\.send\s*\(|\butilityProcess\.\w+|\bparentPort\.\w+/ },
  { kind: 'event', pattern: /(?:\.|\b)(?:\$?emit|on|off|once|addEventListener|removeEventListener|subscribe|unsubscribe|postMessage|dispatchEvent)\s*\(|\bdefineEmits\b|\bonmessage\b/ },
  { kind: 'request', pattern: /\bfetch\s*\(|\baxios(?:\.(?:get|post|put|patch|delete|request|create))?\s*\(|\.(?:get|post|put|patch|delete|request)\s*<[^>]*>\s*\(|\.(?:get|post|put|patch|delete|request)\s*\(\s*['"`/]|\bnew\s+(?:WebSocket|EventSource)\s*\(|\b(?:HubConnectionBuilder|useQuery|useMutation)\b|\.invoke\s*\(\s*['"`]/ },
  { kind: 'timer', pattern: /\b(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/ },
  { kind: 'route', pattern: /\b(?:createRouter|useRoute|useRouter)\s*\(|\brouter\.(?:push|replace|beforeEach|afterEach)\s*\(|^\s*path:\s*['"`]\// },
]

/** Flow sites per file extension. An extension missing here gets its imports only: no site lines. */
export const SITES: Readonly<Record<string, readonly Site[]>> = Object.fromEntries(
  ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'astro'].map((extension) => [extension, SCRIPT]),
)

const EXPORT_PATTERN = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:declare\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
const NAMED_IMPORT = /\bimport\s+(?:type\s+)?([^'";]+?)\s+from\s*['"]([^'"\n]+)['"]/g
const MAX_LINE = 140

const extensionOf = (path: string): string => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''

export interface ChangedFile {
  path: string
  partition: string
  source: string | undefined
  added: ReadonlySet<number>
}

export interface Importer {
  path: string
  source: string
  imports: readonly { target: string; names: readonly string[] }[]
}

export const importedNames = (clause: string): string[] =>
  clause
    .replace(/[{}]/g, ',')
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, ''))
    .filter((part) => part !== '')
    .map((part) => /(?:\bas\s+)([A-Za-z_$][\w$]*)$/.exec(part)?.[1] ?? part)
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))

export const namedImports = (source: string): { spec: string; names: string[] }[] =>
  [...source.matchAll(NAMED_IMPORT)].map((match) => ({ spec: match[2] ?? '', names: importedNames(match[1] ?? '') }))

const trim = (line: string): string => {
  const text = line.trim().replace(/\s+/g, ' ')
  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text
}

const siteKind = (path: string, line: string): string | undefined => (SITES[extensionOf(path)] ?? []).find((site) => site.pattern.test(line))?.kind

const ranges = (lines: ReadonlySet<number>): string => {
  const sorted = [...lines].sort((left, right) => left - right)
  const spans: string[] = []
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index] ?? 0
    let end = start
    while (sorted[index + 1] === end + 1) end = sorted[++index] ?? end
    spans.push(start === end ? `${start}` : `${start}-${end}`)
  }
  return spans.join(',')
}

const changedSection = (file: ChangedFile): string[] => {
  if (file.source === undefined) return [`== ${file.path} [${file.partition}] deleted`]
  const lines = file.source.split('\n')
  const imports = [...new Set(importSpecifiers(file.source))]
  const exports = lines.flatMap((line) => EXPORT_PATTERN.exec(line)?.[1] ?? [])
  const sites = lines.flatMap((line, index) => {
    const kind = siteKind(file.path, line)
    const number = index + 1
    return kind === undefined ? [] : [`L${number}${file.added.has(number) ? '*' : ' '} ${kind.padEnd(10)} ${trim(line)}`]
  })
  return [
    `== ${file.path} [${file.partition}] changed${file.added.size > 0 ? ` +${ranges(file.added)}` : ''}`,
    ...(imports.length > 0 ? [`imports: ${imports.join(', ')}`] : []),
    ...(exports.length > 0 ? [`exports: ${exports.join(', ')}`] : []),
    ...sites,
  ]
}

const importerSection = (importer: Importer): string[] => {
  const names = [...new Set(importer.imports.flatMap((entry) => entry.names))]
  const uses = names.length === 0 ? undefined : new RegExp(`\\b(?:${names.map((name) => name.replace(/\$/g, '\\$')).join('|')})\\b`)
  const sites = importer.source.split('\n').flatMap((line, index) => {
    if (uses === undefined || !uses.test(line) || /^\s*import\b/.test(line)) return []
    return [`L${index + 1}  ${(siteKind(importer.path, line) ?? 'use').padEnd(10)} ${trim(line)}`]
  })
  return [
    `== ${importer.path} [importer] of ${[...new Set(importer.imports.map((entry) => entry.target))].join(', ')}`,
    ...(names.length > 0 ? [`uses: ${names.join(', ')}`] : []),
    ...sites,
  ]
}

export const flowIndex = (files: readonly ChangedFile[], importers: readonly Importer[]): string =>
  [
    `# flow index · ${files.length} changed files · ${importers.length} direct importers`,
    '# site lines: L<line>[* = a line the diff adds] <kind> <code>; kinds: store, store-use, watch, lifecycle, ipc, event, request, timer, route, use (an importer using a changed export)',
    `# sites are found for: ${Object.keys(SITES).join(', ')}; other files list their imports only`,
    ...files.flatMap(changedSection),
    ...importers.flatMap(importerSection),
    '',
  ].join('\n')

const listFiles = (root: string): string[] => {
  const result = git(['-c', 'core.quotePath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
  return result.ok ? result.stdout.split('\0').filter(Boolean) : []
}

const readSource = (root: string, path: string): string | undefined => {
  const full = join(root, path)
  return existsSync(full) ? readFileSync(full, 'utf8') : undefined
}

export const findImporters = (root: string, changed: readonly string[], isProduction: (path: string) => boolean = () => true): Importer[] => {
  const resolve = makeResolver(changed)
  const own = new Set(changed)
  return listFiles(root)
    .filter((path) => !own.has(path) && Object.hasOwn(SITES, extensionOf(path)) && isProduction(path))
    .flatMap((path): Importer[] => {
      const source = readSource(root, path)
      if (source === undefined) return []
      const named = new Map(namedImports(source).map((entry) => [entry.spec, entry.names]))
      const imports = [...new Set(importSpecifiers(source))].flatMap((spec) => {
        const target = resolve(path, spec)
        return target === undefined ? [] : [{ target, names: named.get(spec) ?? [] }]
      })
      return imports.length === 0 ? [] : [{ path, source, imports }]
    })
}

export const changedFile = (root: string, path: string, partition: string, added: ReadonlySet<number>): ChangedFile => ({
  path,
  partition,
  source: readSource(root, path),
  added,
})
