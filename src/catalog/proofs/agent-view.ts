import { createMatcher } from '../../core/glob'
import type { ToolBinary } from '../../tools/tool'
import { isTestFile, type SourceReader } from '../languages'
import { defineCheck, type ProofKind } from './proof'

export const AGENT_VIEW_CONFIG = 'agent-view.config.json'

export const AGENT_VIEW_BINARY: ToolBinary = {
  key: 'agentView',
  label: 'agent-view',
  command: 'agent-view',
  packages: ['@petukhovart/agent-view'],
  configs: [AGENT_VIEW_CONFIG],
  requiresConfig: true,
}

export const MARKUP_FILES = ['**/*.{vue,tsx,jsx,svelte,html}'] as const
export const STYLE_FILES = ['**/*.{css,scss,less}'] as const

const isMarkup = createMatcher(MARKUP_FILES)
const isStyle = createMatcher(STYLE_FILES)

const PROOFS: ReadonlyArray<readonly [ProofKind, RegExp]> = [
  ['behavior', /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+act\s+replay\b/],
  ['look', /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+(?:screenshot|snap)\b/],
]

const requires = (file: string, source?: SourceReader): readonly ProofKind[] => {
  if (isTestFile(file, source)) return []
  if (isMarkup(file)) return ['behavior', 'look']
  if (isStyle(file)) return ['look']
  return []
}

export const agentViewCheck = defineCheck({
  name: 'agent-view',
  binaries: [AGENT_VIEW_BINARY],
  files: [...MARKUP_FILES, ...STYLE_FILES],
  setup: ['agent-view init'],
  requires,
  proves: (command) => PROOFS.filter(([, pattern]) => pattern.test(command)).map(([kind]) => kind),
  hints: {
    behavior: 'agent-view act replay <use case>',
    look: 'agent-view screenshot',
  },
})
