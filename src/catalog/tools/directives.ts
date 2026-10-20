import type { DirectiveSource } from '../../tools/tool'

export const DIRECTIVE_ONLY_TOOLS: readonly DirectiveSource[] = [
  { name: 'biome', comments: { suppressions: [/\bbiome-ignore\b/], allowed: [] } },
  { name: 'vite', comments: { suppressions: [], allowed: [/@vite-ignore/] } },
  { name: 'webpack', comments: { suppressions: [], allowed: [/webpack[A-Z]\w*\s*:/] } },
  { name: 'minifiers', comments: { suppressions: [], allowed: [/[@#]__(?:PURE|NO_SIDE_EFFECTS)__/] } },
  {
    name: 'roslyn',
    comments: {
      suppressions: [/^#\s*pragma\s+warning\s+disable\b/, /^#\s*nullable\s+disable\b/],
      allowed: [/^#\s*(?:pragma|nullable)\b/, /^\/\/\s*<\/?auto-?generated\b/],
    },
  },
]
