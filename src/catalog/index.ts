import { createMatcher } from '../core/glob'
import type { OutputParser, ToolBinary } from '../tools/tool'
import lockfiles from './lockfiles.json'
import { PROOFS, type ProofDefinition } from './proofs'
import { TOOLS, type RegisteredTool } from './tools'
import { parseStratum } from './tools/stratum'

export { fileSource, isTestFile, languageFor, LANGUAGES, lexComments, type Language, type SourceReader } from './languages'
export { PROOFS, type ProofDefinition, type ProofName } from './proofs'
export { DIRECTIVE_SOURCES, TOOLS, type GateRuleId, type RegisteredTool, type ToolName } from './tools'

export interface Lockfile {
  file: string
  install: string
  resolve?: string
  deps?: string
  manifest?: string
  stamp?: readonly string[]
}

export const LOCKFILES: readonly Lockfile[] = lockfiles

export const isLockfile = createMatcher(LOCKFILES.map((lockfile) => `**/${lockfile.file}`))

export type CatalogEntry =
  | { kind: 'tool'; name: string; binaries: readonly ToolBinary[]; setup: readonly string[]; tool: RegisteredTool }
  | { kind: 'proof'; name: string; binaries: readonly ToolBinary[]; setup: readonly string[]; proof: ProofDefinition }

export const CATALOG: readonly CatalogEntry[] = [
  ...TOOLS.map((tool): CatalogEntry => ({ kind: 'tool', name: tool.name, binaries: tool.binaries, setup: tool.setup ?? [], tool })),
  ...PROOFS.map((proof): CatalogEntry => ({ kind: 'proof', name: proof.name, binaries: proof.binaries, setup: proof.setup ?? [], proof })),
]

export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name)
export const PROOF_NAMES: readonly string[] = PROOFS.map((proof) => proof.name)

export const catalogEntry = (name: string): CatalogEntry | undefined => CATALOG.find((entry) => entry.name === name)

export const catalogMarkers = (entry: Pick<CatalogEntry, 'binaries'>): string[] => [...new Set(entry.binaries.flatMap((binary) => binary.configs))]

export const ALL_MARKERS: readonly string[] = [...new Set(CATALOG.flatMap(catalogMarkers))]

export const EXIT_FORMAT = 'exit'
export const JSONL_FORMAT = 'jsonl'

const PARSERS: ReadonlyMap<string, OutputParser> = new Map<string, OutputParser>([
  [JSONL_FORMAT, (stdout) => parseStratum(stdout)],
  ...TOOLS.flatMap((tool): [string, OutputParser][] => (tool.parse === undefined ? [] : [[tool.name, tool.parse]])),
])

export const OUTPUT_FORMATS: readonly string[] = [EXIT_FORMAT, ...PARSERS.keys()]

export const outputParser = (format: string): OutputParser | undefined => PARSERS.get(format)
