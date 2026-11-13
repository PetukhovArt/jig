import type { DirectiveSource } from '../../tools/tool'

export const DIRECTIVE_ONLY_TOOLS: readonly DirectiveSource[] = [
  { name: 'biome', comments: { suppressions: [/\bbiome-ignore\b/] } },
  {
    name: 'roslyn',
    comments: {
      suppressions: [/^#\s*pragma\s+warning\s+disable\b/, /^#\s*nullable\s+disable\b/],
      allowed: [/^#\s*nullable\b/],
    },
  },
  { name: 'resharper', comments: { suppressions: [/\bReSharper\s+disable\b/] } },
]
