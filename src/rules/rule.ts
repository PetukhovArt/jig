export interface Edit {
  before: string
  after: string
  line?: number
  prefix?: string
}

export const fileLine = (edit: Edit, fragmentLine: number): number => fragmentLine + (edit.line ?? 1) - 1
