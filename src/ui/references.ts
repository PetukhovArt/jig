import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { childPath, required, Validator } from '../core/validator'
import { existingUiBranchDir, uiBranchDir } from './dir'

export interface ReferenceEntry {
  n: number
  source: string
  covers?: string
  image?: string
  tree?: string
}

export interface References {
  version: 1
  none?: string
  entries: ReferenceEntry[]
}

export const REFERENCES_FILE = 'references.json'
export const REFERENCE_IMAGE = 'image.png'
export const REFERENCE_TREE = 'tree.json'
export const MISSING_REFERENCES = 'no references recorded for this branch: step 2 of flow ui lists the task\'s references (jig ui reference add "<source>") or records none (jig ui reference none "<reason>")'

const ENTRY_KEYS = ['n', 'source', 'covers', 'image', 'tree'] as const
const FILE_KEYS = ['$schema', 'version', 'none', 'entries'] as const

export const referencesFile = (root: string): string => join(existingUiBranchDir(root), REFERENCES_FILE)

export const referenceDir = (root: string, n: number): string => join(uiBranchDir(root), 'references', String(n))

const readEntry = (validator: Validator, value: unknown, path: string): ReferenceEntry | undefined => {
  const object = validator.object(value, path, ENTRY_KEYS)
  if (object === undefined || !required(validator, object, path, ['n', 'source'])) return undefined
  const n = validator.integer(object['n'], childPath(path, 'n'), 1)
  const source = validator.string(object['source'], childPath(path, 'source'))
  const text = (key: 'covers' | 'image' | 'tree'): string | undefined => (object[key] === undefined ? undefined : validator.string(object[key], childPath(path, key)))
  const covers = text('covers')
  const image = text('image')
  const tree = text('tree')
  if (n === undefined || source === undefined) return undefined
  return { n, source, ...(covers === undefined ? {} : { covers }), ...(image === undefined ? {} : { image }), ...(tree === undefined ? {} : { tree }) }
}

export const parseReferences = (text: string): { references?: References; errors: string[] } => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { errors: [`$: not JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const validator = new Validator()
  const object = validator.object(value, '$', FILE_KEYS)
  if (object === undefined || !required(validator, object, '$', ['version', 'entries'])) return { errors: validator.errors }
  if (object['version'] !== 1) validator.report('$.version', 'expected 1')
  const none = object['none'] === undefined ? undefined : validator.string(object['none'], '$.none')
  const list = object['entries']
  if (!Array.isArray(list)) validator.report('$.entries', 'expected an array')
  const entries = Array.isArray(list) ? list.flatMap((entry, index) => readEntry(validator, entry, childPath('$.entries', index)) ?? []) : []
  if (validator.errors.length > 0) return { errors: validator.errors }
  return { references: { version: 1, ...(none === undefined ? {} : { none }), entries }, errors: [] }
}

export const readReferences = (root: string): References | undefined => {
  const file = referencesFile(root)
  if (!existsSync(file)) return undefined
  const parsed = parseReferences(readFileSync(file, 'utf8'))
  if (parsed.references === undefined) throw new Error(`${file}: ${parsed.errors.join('; ')}`)
  return parsed.references
}

export const writeReferences = (root: string, references: References): void => {
  const dir = uiBranchDir(root)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, REFERENCES_FILE), `${JSON.stringify(references, null, 2)}\n`)
}

export const attachFile = (root: string, entry: ReferenceEntry, kind: 'image' | 'tree', from: string): ReferenceEntry => {
  const name = kind === 'image' ? REFERENCE_IMAGE : REFERENCE_TREE
  const target = join(referenceDir(root, entry.n), name)
  mkdirSync(dirname(target), { recursive: true })
  if (from !== target) copyFileSync(from, target)
  return { ...entry, [kind]: `references/${entry.n}/${name}` }
}

export const referencePath = (root: string, relative: string): string => join(existingUiBranchDir(root), relative)
