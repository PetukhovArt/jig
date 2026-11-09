import { readFileSync } from 'node:fs'
import { toSlash } from '../core/paths'
import type { SessionState } from '../core/state'
import { chainFor, pathKey, renderGlossary, renderRules, type Glossary } from './chain'

export const CONTEXT_BUDGET = 9000

const GLOSSARY_KEY = 'glossary:'

const HEADER =
  'jig: project instructions for the paths you just touched that your harness has not loaded. They bind the code there like CLAUDE.md and AGENTS.md:'

interface Untold {
  rules: string[]
  glossaries: Glossary[]
}

const toldSet = (state: SessionState, agent: string): Set<string> => new Set(state.toldRules?.[agent] ?? [])

export const markTold = (state: SessionState, agent: string, paths: readonly string[]): void => {
  if (paths.length === 0 && state.toldRules?.[agent] !== undefined) return
  const told = toldSet(state, agent)
  for (const path of paths) told.add(path.startsWith(GLOSSARY_KEY) ? path : pathKey(path))
  state.toldRules = { ...state.toldRules, [agent]: [...told] }
}

export const resetTold = (state: SessionState, agent: string): void => {
  if (state.toldRules?.[agent] === undefined) return
  const { [agent]: _dropped, ...rest } = state.toldRules
  state.toldRules = rest
}

const untoldFor = (state: SessionState, agent: string, targets: readonly string[]): Untold => {
  const told = toldSet(state, agent)
  const rules: string[] = []
  const glossaries: Glossary[] = []
  for (const target of targets) {
    const chain = chainFor(target)
    if (chain === undefined) continue
    for (const rule of chain.rules) {
      const key = pathKey(rule)
      if (told.has(key)) continue
      told.add(key)
      rules.push(rule)
    }
    if (chain.glossary !== undefined && !told.has(GLOSSARY_KEY + pathKey(chain.glossary.path))) {
      told.add(GLOSSARY_KEY + pathKey(chain.glossary.path))
      glossaries.push(chain.glossary)
    }
  }
  return { rules, glossaries }
}

const sizeOf = (path: string): number => {
  try {
    return readFileSync(path, 'utf8').length
  } catch {
    return 0
  }
}

const withinBudget = (rules: readonly string[]): { inline: string[]; byPath: string[] } => {
  const inline: string[] = []
  const byPath: string[] = []
  let used = HEADER.length
  for (const rule of rules) {
    const size = sizeOf(rule) + rule.length + 10
    if (byPath.length === 0 && used + size <= CONTEXT_BUDGET) {
      inline.push(rule)
      used += size
    } else {
      byPath.push(rule)
    }
  }
  return { inline, byPath }
}

const render = (inline: readonly string[], byPath: readonly string[], glossaries: readonly Glossary[]): string =>
  [
    HEADER,
    ...(inline.length === 0 ? [] : [renderRules(inline)]),
    ...(byPath.length === 0 ? [] : [`Too long to include here, so read each of these with your file-reading tool before you edit there: ${byPath.map(toSlash).join(', ')}`]),
    ...glossaries.map(renderGlossary),
  ].join('\n\n')

export interface Delivery {
  text: string
  hasRules: boolean
}

export const deliver = (state: SessionState, agent: string, targets: readonly string[], options: { requireRules?: boolean } = {}): Delivery | undefined => {
  const { rules, glossaries } = untoldFor(state, agent, targets)
  if (rules.length === 0 && (glossaries.length === 0 || options.requireRules === true)) return undefined
  const { inline, byPath } = withinBudget(rules)
  markTold(state, agent, [...inline, ...glossaries.map((glossary) => GLOSSARY_KEY + pathKey(glossary.path))])
  return { text: render(inline, byPath, glossaries), hasRules: rules.length > 0 }
}
