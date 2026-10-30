import type { Price } from '../tiers/tiers'

export const DEFAULT_PRICES: Readonly<Record<string, Price>> = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
}

export const CACHE_MULTIPLIERS = { write5m: 1.25, write1h: 2, read: 0.1 } as const

export const priceOf = (model: string, prices: Readonly<Record<string, Price>>): Price | undefined =>
  Object.entries(prices).find(([family]) => model.includes(family))?.[1]
