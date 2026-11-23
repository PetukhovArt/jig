export type Json = Record<string, unknown>

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

export const childPath = (path: string, key: string | number): string => {
  if (typeof key === 'number') return `${path}[${key}]`
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

export const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class Validator {
  readonly errors: string[] = []

  report(path: string, problem: string): undefined {
    this.errors.push(`${path}: ${problem}`)
    return undefined
  }

  object(value: unknown, path: string, keys: readonly string[] | undefined): Json | undefined {
    if (!isObject(value)) return this.report(path, 'expected an object')
    if (keys === undefined) return value
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        this.report(childPath(path, key), 'unknown key')
      }
    }
    return value
  }

  string(value: unknown, path: string): string | undefined {
    return typeof value === 'string' ? value : this.report(path, 'expected a string')
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | undefined {
    const isAllowed = typeof value === 'string' && (allowed as readonly string[]).includes(value)
    return isAllowed ? (value as T) : this.report(path, `expected one of ${allowed.join(', ')}`)
  }

  integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
    const isInRange = Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    if (isInRange) return value as number
    const range = max === Number.MAX_SAFE_INTEGER ? `>= ${min}` : `${min}..${max}`
    return this.report(path, `expected an integer ${range}`)
  }

  amount(value: unknown, path: string): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : this.report(path, 'expected a number >= 0')
  }

  strings(value: unknown, path: string): string[] | undefined {
    if (!Array.isArray(value)) return this.report(path, 'expected an array of strings')
    const before = this.errors.length
    value.forEach((item, index) => this.string(item, childPath(path, index)))
    return this.errors.length === before ? (value as string[]) : undefined
  }
}

export const required = (validator: Validator, object: Json, path: string, keys: readonly string[]): boolean => {
  const missing = keys.filter((key) => !Object.hasOwn(object, key))
  missing.forEach((key) => validator.report(childPath(path, key), 'is required'))
  return missing.length === 0
}
