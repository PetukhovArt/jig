import { readFileSync, statSync } from 'node:fs'

const MAX_BYTES = 1_000_000
const SNIFF_BYTES = 8000

export const readText = (path: string): string | undefined => {
  try {
    if (statSync(path).size > MAX_BYTES) return undefined
    const buffer = readFileSync(path)
    return buffer.subarray(0, SNIFF_BYTES).includes(0) ? undefined : buffer.toString('utf8')
  } catch {
    return undefined
  }
}
