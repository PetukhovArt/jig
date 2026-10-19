import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join, posix } from 'node:path'
import { CATALOG, catalogMarkers, type CatalogEntry } from '../catalog'
import type { JigConfig, ToolSetting } from '../core/config'
import { git } from '../core/git'
import { resolveBin } from '../core/proc'
import { detectTypeCheck, type TypeCheckDetection } from './typecheck'

export type FoundStatus = 'ready' | 'needs-setup'

export interface Found {
  name: string
  kind: CatalogEntry['kind']
  status: FoundStatus
  markers: string[]
  packages: string[]
  command?: string
  bin?: string[]
  setup: readonly string[]
}

export interface Discovery {
  typeCheck: TypeCheckDetection
  found: Found[]
  packages: string[]
  packageFiles: string[]
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor'])
const WALK_DEPTH = 4
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

const FIXTURE_DIR = /fixture/i

const isSkippedDir = (part: string): boolean => SKIPPED_DIRS.has(part) || part === '.git' || FIXTURE_DIR.test(part)

const isSkippedPath = (path: string): boolean => path.split('/').slice(0, -1).some(isSkippedDir)

const walk = (root: string, dir = '', depth = 0): string[] => {
  let entries: Dirent[]
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.isFile()) return [path]
    const isWalked = entry.isDirectory() && depth < WALK_DEPTH && !entry.name.startsWith('.') && !isSkippedDir(entry.name)
    return isWalked ? walk(root, path, depth + 1) : []
  })
}

/** Project files without ignored ones: git when the project is a repository, else a shallow walk. */
export const projectFiles = (projectRoot: string): string[] => {
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], projectRoot)
  const files = listed.ok ? listed.stdout.split('\0').filter(Boolean) : walk(projectRoot)
  return files.map((file) => file.replace(/\\/g, '/')).filter((file) => !isSkippedPath(file))
}

const readDependencies = (path: string): string[] => {
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return DEPENDENCY_FIELDS.flatMap((field) => {
      const deps = manifest[field]
      return typeof deps === 'object' && deps !== null ? Object.keys(deps) : []
    })
  } catch {
    return []
  }
}

const suggestCommand = (entry: CatalogEntry, declared: ReadonlySet<string>): string | undefined =>
  entry.binaries.slice(1).find((binary) => binary.packages.some((pkg) => declared.has(pkg)))?.command

const inspect = (projectRoot: string, entry: CatalogEntry, files: readonly string[], declared: ReadonlySet<string>): Found | undefined => {
  const markerNames = new Set(catalogMarkers(entry))
  const markers = files.filter((file) => markerNames.has(posix.basename(file)))
  const packages = [...new Set(entry.binaries.flatMap((binary) => binary.packages))].filter((pkg) => declared.has(pkg))
  if (markers.length === 0 && packages.length === 0) return undefined
  const command = suggestCommand(entry, declared)
  const binary = entry.binaries.find((candidate) => candidate.command === command) ?? entry.binaries[0]
  const bin = binary === undefined ? undefined : resolveBin(projectRoot, binary.packages, binary.command)
  const needsMarker = markerNames.size > 0
  const status: FoundStatus = needsMarker && markers.length === 0 ? 'needs-setup' : 'ready'
  return {
    name: entry.name,
    kind: entry.kind,
    status,
    markers,
    packages,
    ...(command === undefined ? {} : { command }),
    ...(bin === undefined ? {} : { bin }),
    setup: entry.setup,
  }
}

export const discover = (projectRoot: string): Discovery => {
  const files = projectFiles(projectRoot)
  const packageFiles = files.filter((file) => posix.basename(file) === 'package.json')
  const declared = new Set(packageFiles.flatMap((file) => readDependencies(join(projectRoot, file))))
  const found = CATALOG.map((entry) => inspect(projectRoot, entry, files, declared)).filter((item): item is Found => item !== undefined)
  return { found, packages: [...declared].sort(), packageFiles, typeCheck: detectTypeCheck(projectRoot, files) }
}

const settingsOf = (config: Pick<JigConfig, 'tools' | 'proofs'>, kind: CatalogEntry['kind']): Readonly<Record<string, ToolSetting>> =>
  kind === 'tool' ? config.tools : config.proofs

export const isListed = (config: Pick<JigConfig, 'tools' | 'proofs'>, found: Pick<Found, 'name' | 'kind'>): boolean =>
  Object.hasOwn(settingsOf(config, found.kind), found.name)

/** Catalog entries the project has and the config does not name, neither on nor `false`. */
export const unlisted = (config: Pick<JigConfig, 'tools' | 'proofs'>, discovery: Discovery): Found[] =>
  discovery.found.filter((found) => found.status === 'ready' && !isListed(config, found))
