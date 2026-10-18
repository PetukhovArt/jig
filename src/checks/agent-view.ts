import { createMatcher } from '../core/glob'
import { isTestFile } from '../core/test-files'
import type { ToolBinary } from '../tools/tool'
import { defineCheck, type ProofKind } from './check'

export const AGENT_VIEW_CONFIG = 'agent-view.config.json'

export const AGENT_VIEW_BINARY: ToolBinary = {
  key: 'agentView',
  label: 'agent-view',
  command: 'agent-view',
  packages: ['@petukhovart/agent-view'],
  configs: [AGENT_VIEW_CONFIG],
  requiresConfig: true,
}

const isMarkup = createMatcher(['**/*.{vue,tsx,jsx,svelte,html}'])
const isStyle = createMatcher(['**/*.{css,scss,less}'])

const PROOFS: ReadonlyArray<readonly [ProofKind, RegExp]> = [
  ['behavior', /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+act\s+replay\b/],
  ['look', /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+(?:screenshot|snap)\b/],
]

const requires = (file: string): readonly ProofKind[] => {
  if (isTestFile(file)) return []
  if (isMarkup(file)) return ['behavior', 'look']
  if (isStyle(file)) return ['look']
  return []
}

export const agentViewCheck = defineCheck({
  name: 'agent-view',
  binaries: [AGENT_VIEW_BINARY],
  requires,
  proves: (command) => PROOFS.filter(([, pattern]) => pattern.test(command)).map(([kind]) => kind),
  hints: {
    behavior: 'agent-view act replay <use case>',
    look: 'agent-view screenshot',
  },
})
