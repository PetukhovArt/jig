const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/

const escapeChar = (char: string): string => (REGEX_SPECIAL.test(char) ? `\\${char}` : char)

const translateClass = (glob: string, start: number): { source: string; end: number } | undefined => {
  let index = start + 1
  let negated = false
  if (glob[index] === '!' || glob[index] === '^') {
    negated = true
    index++
  }
  let body = ''
  if (glob[index] === ']') {
    body += '\\]'
    index++
  }
  while (index < glob.length && glob[index] !== ']') {
    const char = glob[index] ?? ''
    if (char === '\\' && index + 1 < glob.length) {
      body += `\\${glob[index + 1]}`
      index += 2
      continue
    }
    body += char === '[' || char === '^' ? `\\${char}` : char
    index++
  }
  if (index >= glob.length) return undefined
  return { source: negated ? `[^/${body}]` : `[${body}]`, end: index + 1 }
}

export const globToRegExpSource = (glob: string): string => {
  let source = ''
  let braceDepth = 0
  let index = 0
  while (index < glob.length) {
    const char = glob[index] ?? ''
    if (char === '*') {
      const isGlobstar = glob[index + 1] === '*'
      if (!isGlobstar) {
        source += '[^/]*'
        index++
        continue
      }
      const isDirectoryGlobstar = glob[index + 2] === '/'
      source += isDirectoryGlobstar ? '(?:.*/)?' : '.*'
      index += isDirectoryGlobstar ? 3 : 2
      continue
    }
    if (char === '?') {
      source += '[^/]'
      index++
      continue
    }
    if (char === '[') {
      const charClass = translateClass(glob, index)
      source += charClass?.source ?? '\\['
      index = charClass?.end ?? index + 1
      continue
    }
    if (char === '{') {
      braceDepth++
      source += '(?:'
      index++
      continue
    }
    if (char === '}' && braceDepth > 0) {
      braceDepth--
      source += ')'
      index++
      continue
    }
    if (char === ',' && braceDepth > 0) {
      source += '|'
      index++
      continue
    }
    if (char === '\\' && index + 1 < glob.length) {
      source += escapeChar(glob[index + 1] ?? '')
      index += 2
      continue
    }
    source += escapeChar(char)
    index++
  }
  return source + ')'.repeat(braceDepth)
}

export const globToRegExp = (glob: string): RegExp => new RegExp(`^${globToRegExpSource(glob)}$`)

export type PathMatcher = (path: string) => boolean

export const createMatcher = (globs: readonly string[]): PathMatcher => {
  if (globs.length === 0) return () => false
  const pattern = new RegExp(`^(?:${globs.map(globToRegExpSource).join('|')})$`)
  return (path) => pattern.test(path.replace(/\\/g, '/'))
}

export const matchGlob = (path: string, glob: string | readonly string[]): boolean =>
  createMatcher(typeof glob === 'string' ? [glob] : glob)(path)
