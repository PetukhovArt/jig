export interface StorageBackend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface Persisted<T> {
  read(): T
  write(value: T): void
  clear(): void
}

const PREFIX = 'camera-console:'

export const memoryBackend = (): StorageBackend => {
  const entries = new Map<string, string>()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
}

const defaultBackend = (): StorageBackend =>
  typeof globalThis.localStorage === 'undefined' ? memoryBackend() : globalThis.localStorage

let backend = defaultBackend()

export const useStorageBackend = (next: StorageBackend): void => {
  backend = next
}

const parse = (raw: string | null): unknown => {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export const persisted = <T>(key: string, fallback: T, isValid: (value: unknown) => value is T): Persisted<T> => {
  const fullKey = `${PREFIX}${key}`
  return {
    read: () => {
      const value = parse(backend.getItem(fullKey))
      return isValid(value) ? value : fallback
    },
    write: (value) => {
      backend.setItem(fullKey, JSON.stringify(value))
    },
    clear: () => {
      backend.removeItem(fullKey)
    },
  }
}
