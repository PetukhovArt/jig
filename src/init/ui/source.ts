import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Source {
  files: string[]
  packages: ReadonlySet<string>
  read: (path: string) => string
}

const MAX_BYTES = 200_000
const SKIPPED_SEGMENTS = new Set(['public', 'vendor', 'docs', 'pages-drafts', 'gen', 'generated', 'autogen', 'stories', 'storybook-static'])
const NOT_SCANNED_FILE = /\.(?:d\.ts|min\.[a-z]+)$|\.(?:test|spec|stories)\./

export const isScanned = (path: string): boolean =>
  !NOT_SCANNED_FILE.test(path) && !path.split('/').slice(0, -1).some((segment) => SKIPPED_SEGMENTS.has(segment))

export const createSource = (projectRoot: string, files: string[], packages: Iterable<string>): Source => {
  const cache = new Map<string, string>()
  const read = (path: string): string => {
    const cached = cache.get(path)
    if (cached !== undefined) return cached
    let text = ''
    try {
      if (statSync(join(projectRoot, path)).size <= MAX_BYTES) text = readFileSync(join(projectRoot, path), 'utf8')
    } catch {
      text = ''
    }
    cache.set(path, text)
    return text
  }
  return { files, packages: new Set(packages), read }
}

export const hasPackage = (source: Source, ...names: string[]): boolean => names.some((name) => source.packages.has(name))

export const hasPackagePrefix = (source: Source, prefix: string): boolean => [...source.packages].some((name) => name.startsWith(prefix))

export const filesMatching = (source: Source, pattern: RegExp): string[] => source.files.filter((file) => isScanned(file) && pattern.test(file))
