import { runReviewCost } from './cost'
import { runReviewState } from './state-summary'

type Command = (args: string[]) => number

const SUBCOMMANDS = new Map<string, Command>([
  ['cost', runReviewCost],
  ['state', runReviewState],
])

export const runReview: Command = (args) => {
  const [sub, ...rest] = args
  const command = sub === undefined ? undefined : SUBCOMMANDS.get(sub)
  if (command === undefined) throw new Error(`usage: jig review <${[...SUBCOMMANDS.keys()].join('|')}> ...`)
  return command(rest)
}
