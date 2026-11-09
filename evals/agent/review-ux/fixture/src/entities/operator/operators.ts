export interface Operator {
  id: string
  name: string
  email: string
}

export const fetchOperators = async (): Promise<Operator[]> => {
  const response = await fetch('/api/operators')
  return (await response.json()) as Operator[]
}
