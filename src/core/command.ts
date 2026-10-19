const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g

/** Splits a command line into argv the way a shell would for plain words and quoted words; no expansion. */
export const splitCommand = (text: string): string[] =>
  [...text.matchAll(TOKEN)].map((match) => match[1] ?? match[2] ?? match[3] ?? '')

/** Replaces the token `placeholder` with `values`, one argv entry each. */
export const expandToken = (argv: readonly string[], placeholder: string, values: readonly string[]): string[] =>
  argv.flatMap((token) => (token === placeholder ? [...values] : [token]))
