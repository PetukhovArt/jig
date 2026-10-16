import { describe, expect, it } from 'vitest'
import { pageCount, paginate } from './paginate'

const numbers = Array.from({ length: 12 }, (_, index) => index + 1)

describe('pageCount', () => {
  it('rounds a partial page up', () => {
    expect(pageCount(12, 5)).toBe(3)
  })

  it('keeps one page for an empty list', () => {
    expect(pageCount(0, 5)).toBe(1)
  })
})

describe('paginate', () => {
  it('returns the first page', () => {
    expect(paginate(numbers, 1, 5).items).toEqual([1, 2, 3, 4, 5])
  })

  it('clamps a page below the range to the first page', () => {
    expect(paginate(numbers, 0, 5).page).toBe(1)
  })
})
