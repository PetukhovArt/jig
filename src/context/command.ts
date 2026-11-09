import { resolve } from 'node:path'
import { toSlash } from '../core/paths'
import { chainFor, renderGlossary, renderRules } from './chain'

type Command = (args: string[]) => number

const USAGE = 'usage: jig context [--paths] <file or directory>...'

export const runContext: Command = (args) => {
  const pathsOnly = args.includes('--paths')
  const targets = args.filter((arg) => arg !== '--paths')
  if (targets.length === 0) throw new Error(USAGE)
  const rules: string[] = []
  const glossaries = new Map<string, string>()
  for (const target of targets) {
    const chain = chainFor(resolve(target))
    if (chain === undefined) continue
    for (const rule of chain.rules) if (!rules.includes(rule)) rules.push(rule)
    if (chain.glossary !== undefined) glossaries.set(chain.glossary.path, renderGlossary(chain.glossary))
  }
  const body = pathsOnly ? rules.map(toSlash).join('\n') : renderRules(rules)
  const out = [body, ...glossaries.values()].filter((part) => part !== '').join('\n\n')
  if (out !== '') process.stdout.write(`${out}\n`)
  return 0
}
