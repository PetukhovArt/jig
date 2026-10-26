import { runReviewCost } from './cost'
import { runReviewRules } from './rules'
import { runReviewState } from './state-summary'

type Command = (args: string[]) => number

const SUBCOMMANDS = new Map<string, Command>([
  ['cost', runReviewCost],
  ['rules', runReviewRules],
  ['state', runReviewState],
])

export const runReview: Command = (args) => {
  const [sub, ...rest] = args
  const command = sub === undefined ? undefined : SUBCOMMANDS.get(sub)
  if (command === undefined) throw new Error(`usage: jig review <${[...SUBCOMMANDS.keys()].join('|')}> ...`)
  return command(rest)
}
