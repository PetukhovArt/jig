export const FILTER_FIELDS = ['status', 'name', 'tag'] as const

export type FilterField = (typeof FILTER_FIELDS)[number]

export interface FieldCondition {
  field: FilterField
  value: string
  negated: boolean
}

export interface ParsedFilter {
  terms: string[]
  conditions: FieldCondition[]
  errors: string[]
}

const isFilterField = (value: string): value is FilterField => FILTER_FIELDS.some((field) => field === value)

const tokenize = (input: string): string[] => {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (current !== '') tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') tokens.push(current)
  return tokens
}

export const parseFilter = (input: string): ParsedFilter => {
  const result: ParsedFilter = { terms: [], conditions: [], errors: [] }
  if (input.split('"').length % 2 === 0) {
    result.errors.push('unterminated quote')
  }
  for (const token of tokenize(input)) {
    const negated = token.startsWith('-') && token.includes(':')
    const body = negated ? token.slice(1) : token
    const separator = body.indexOf(':')
    if (separator <= 0) {
      result.terms.push(token.toLowerCase())
      continue
    }
    const key = body.slice(0, separator).toLowerCase()
    const value = body.slice(separator + 1)
    if (!isFilterField(key)) {
      result.errors.push(`unknown field "${key}"`)
      continue
    }
    if (value === '') {
      result.errors.push(`empty value for "${key}"`)
      continue
    }
    result.conditions.push({ field: key, value: key === 'name' ? value : value.toLowerCase(), negated })
  }
  return result
}
