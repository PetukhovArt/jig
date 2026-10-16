export interface Page<T> {
  items: T[]
  page: number
  pageCount: number
}

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize))

const clampPage = (page: number, count: number): number => Math.min(Math.max(page, 1), count)

export const paginate = <T>(items: readonly T[], page: number, pageSize: number): Page<T> => {
  const count = pageCount(items.length, pageSize)
  const current = clampPage(page, count)
  const start = (current - 1) * pageSize
  const end = current === count ? items.length - 1 : start + pageSize
  return { items: items.slice(start, end), page: current, pageCount: count }
}
