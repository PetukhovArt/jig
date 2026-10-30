import type { Price } from '../tiers/tiers'
import { CACHE_MULTIPLIERS, priceOf } from './prices'

export const BASE_CONTEXT = 30_000
export const TOKENS_PER_LINE = 150
export const TURNS_BASE = 15
export const LINES_PER_TURN = 24
export const MAX_TURNS = 150
export const OUTPUT_PER_TURN = 800
export const CHARS_PER_TOKEN = 4
export const MODELER_TOKENS_PER_LINE = 25
export const MODELER_LINES_PER_TURN = 108

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
  modeler: ReaderEstimate
  finders: ReaderEstimate[]
  dollars: number
  priced: boolean
  models: string[]
}

const turnsFor = (lines: number, perTurn: number): number => Math.min(MAX_TURNS, TURNS_BASE + Math.ceil(Math.max(0, lines) / perTurn))

export const finderReader = (lines: number, model: string | undefined): Reader => ({
  context: BASE_CONTEXT + Math.max(0, lines) * TOKENS_PER_LINE,
  turns: turnsFor(lines, LINES_PER_TURN),
  model,
})

export const modelerReader = (indexChars: number, lines: number, model: string | undefined): Reader => ({
  context: BASE_CONTEXT + Math.ceil(indexChars / CHARS_PER_TOKEN) + Math.max(0, lines) * MODELER_TOKENS_PER_LINE,
  turns: turnsFor(lines, MODELER_LINES_PER_TURN),
  model,
})

export const readerEstimate = (reader: Reader, prices: Readonly<Record<string, Price>>): ReaderEstimate => {
  const price = reader.model === undefined ? undefined : priceOf(reader.model, prices)
  const cacheReads = reader.turns * ((BASE_CONTEXT + reader.context) / 2)
  const input = cacheReads * CACHE_MULTIPLIERS.read + reader.context * CACHE_MULTIPLIERS.write5m
  const dollars = price === undefined ? 0 : (input * price.input + reader.turns * OUTPUT_PER_TURN * price.output) / 1e6
  return { context: reader.context, turns: reader.turns, dollars, priced: price !== undefined }
}

export const estimateReview = (modeler: Reader, finders: readonly Reader[], prices: Readonly<Record<string, Price>>): Estimate => {
  const own = readerEstimate(modeler, prices)
  const each = finders.map((finder) => readerEstimate(finder, prices))
  const all = [own, ...each]
  const models = [...new Set([modeler, ...finders].map((reader) => reader.model).filter((model): model is string => model !== undefined))]
  return { modeler: own, finders: each, dollars: all.reduce((sum, reader) => sum + reader.dollars, 0), priced: all.every((reader) => reader.priced), models }
}

const thousands = (tokens: number): string => `${Math.round(tokens / 1000)}k`
const money = (dollars: number): string => `$${dollars < 10 ? dollars.toFixed(1) : Math.round(dollars).toString()}`

export const estimateLine = (estimate: Estimate): string => {
  const { modeler, finders } = estimate
  const finderDollars = finders.reduce((sum, finder) => sum + finder.dollars, 0)
  const widest = finders.reduce((max, finder) => (finder.context > max.context ? finder : max), finders[0] ?? modeler)
  const shape = `flow model 1 × ${thousands(modeler.context)} context × ${modeler.turns} turns + finders ${finders.length} × up to ${thousands(widest.context)} × ${widest.turns} turns`
  const models = estimate.models.length > 0 ? estimate.models.join(', ') : 'no model resolved'
  if (!estimate.priced) return `cost estimate: no price for ${models} (prices in ~/.jig/config.jsonc) · ${shape}`
  return `cost estimate: ~${money(estimate.dollars)} (flow model ${money(modeler.dollars)} + finders ${money(finderDollars)}) · ${shape} · list prices of ${models}; runner and judges not included`
}
