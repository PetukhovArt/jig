import type { Price } from '../tiers/tiers'
import { CACHE_MULTIPLIERS, priceOf } from './prices'

export const BASE_CONTEXT = 30_000
export const FINDER_BASE_CONTEXT = 200_000
export const TOKENS_PER_LINE = 60
export const FINDER_BASE_TURNS = 85
export const LINES_PER_TURN = 120
export const MAX_TURNS = 150
export const OUTPUT_PER_TURN = 800

export interface Reader {
  context: number
  turns: number
  model: string | undefined
}

export interface ReaderEstimate {
  context: number
  turns: number
  dollars: number
  priced: boolean
}

export interface Estimate {
  finders: ReaderEstimate[]
  dollars: number
  priced: boolean
  models: string[]
}

export const finderReader = (lines: number, model: string | undefined): Reader => ({
  context: FINDER_BASE_CONTEXT + Math.max(0, lines) * TOKENS_PER_LINE,
  turns: Math.min(MAX_TURNS, FINDER_BASE_TURNS + Math.ceil(Math.max(0, lines) / LINES_PER_TURN)),
  model,
})

export const readerEstimate = (reader: Reader, prices: Readonly<Record<string, Price>>): ReaderEstimate => {
  const price = reader.model === undefined ? undefined : priceOf(reader.model, prices)
  const cacheReads = reader.turns * ((BASE_CONTEXT + reader.context) / 2)
  const input = cacheReads * CACHE_MULTIPLIERS.read + reader.context * CACHE_MULTIPLIERS.write5m
  const dollars = price === undefined ? 0 : (input * price.input + reader.turns * OUTPUT_PER_TURN * price.output) / 1e6
  return { context: reader.context, turns: reader.turns, dollars, priced: price !== undefined }
}

export const estimateReview = (finders: readonly Reader[], prices: Readonly<Record<string, Price>>): Estimate => {
  const each = finders.map((finder) => readerEstimate(finder, prices))
  const models = [...new Set(finders.map((reader) => reader.model).filter((model): model is string => model !== undefined))]
  return { finders: each, dollars: each.reduce((sum, reader) => sum + reader.dollars, 0), priced: each.every((reader) => reader.priced), models }
}

const thousands = (tokens: number): string => `${Math.round(tokens / 1000)}k`
const money = (dollars: number): string => `$${dollars < 10 ? dollars.toFixed(1) : Math.round(dollars).toString()}`

export const estimateLine = (estimate: Estimate): string => {
  const { finders } = estimate
  const widest = finders.reduce<ReaderEstimate | undefined>((max, finder) => (max === undefined || finder.context > max.context ? finder : max), undefined)
  const shape = `finders ${finders.length} × up to ${thousands(widest?.context ?? 0)} context × ${widest?.turns ?? 0} turns`
  const models = estimate.models.length > 0 ? estimate.models.join(', ') : 'no model resolved'
  if (!estimate.priced) return `cost estimate: no price for ${models} (prices in ~/.jig/config.jsonc) · ${shape}`
  return `cost estimate: ~${money(estimate.dollars)} · ${shape} · list prices of ${models}; runner and judges not included`
}
