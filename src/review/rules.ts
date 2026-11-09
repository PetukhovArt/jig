import { gitToplevel } from '../core/git'
import { resolveBase, splitPathspec, toRootPaths } from './review-plan'
import { glossaryAvoidHits, type AvoidHit } from './glossary-avoid'
import { changedPaths, ruleDocuments, type ReviewInputs } from './rule-docs'

export type { ReviewInputs }

type Command = (args: string[]) => number

export const reviewInputs = (root: string, base: string, paths: readonly string[], env: NodeJS.ProcessEnv): ReviewInputs & { avoid: AvoidHit[] } => {
  const { mergeBase } = resolveBase(root, base, 'review rules', paths)
  const inputs = ruleDocuments(root, changedPaths(root, mergeBase, paths), env)
  return { ...inputs, avoid: glossaryAvoidHits(root, mergeBase, paths, inputs) }
}

const avoidLine = (hit: AvoidHit): string =>
  `avoid ${hit.file}:${hit.line} ${hit.word}${hit.lines > 1 ? ` (${hit.lines} lines)` : ''} · ${hit.glossary}:${hit.glossaryLine} ${hit.quote}`

const USAGE = 'usage: jig review rules [<base>] [-- <pathspec>...]'

export const runReviewRules: Command = (args) => {
  const split = splitPathspec(args)
  if (split.options.length > 1) throw new Error(USAGE)
  const root = gitToplevel(process.cwd())
  if (root === undefined) throw new Error('not inside a git repository')
  const paths = toRootPaths(root, process.cwd(), split.paths ?? [])
  const inputs = reviewInputs(root, split.options[0] ?? '', paths, process.env)
  const scope = (path: string): string => (inputs.scopes[path] === '' ? '' : ` · scope ${inputs.scopes[path]}/`)
  const output = [
    ...inputs.indexes.map((path) => `index ${path}${scope(path)}`),
    ...inputs.standards.map((path) => `standard ${path}${scope(path)}`),
    ...inputs.glossaries.map((path) => `glossary ${path}${scope(path)}`),
    ...inputs.avoid.map(avoidLine),
  ]
  process.stdout.write(`${output.join('\n')}\n`)
  return 0
}
