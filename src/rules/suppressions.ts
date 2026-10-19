import { DIRECTIVE_SOURCES } from '../catalog'

const firstMatch = (patterns: readonly RegExp[], text: string): string | undefined => {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match !== null) return match[0]
  }
  return undefined
}

export const findSuppression = (comment: string): string | undefined =>
  firstMatch(DIRECTIVE_SOURCES.flatMap((source) => source.comments?.suppressions ?? []), comment)

export const isToolDirective = (comment: string): boolean =>
  firstMatch(DIRECTIVE_SOURCES.flatMap((source) => source.comments?.allowed ?? []), comment) !== undefined
