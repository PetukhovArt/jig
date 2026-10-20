export type ReplayOutcome = 'done' | 'final' | 'early'

export declare const mean: (values: number[]) => number | undefined

export declare const budgetCheck: (input: { maxUsd?: number | undefined; finishedCosts: number[]; inFlight?: number; estimateUsd?: number | undefined }) => {
  allowed: boolean
  spentUsd: number
  perRunUsd: number
  projectedUsd: number
}

export declare const classifyReplay: (result: { code: number | null; output: string }, useCase: { useCase: string; finalSteps?: string[] }) => ReplayOutcome

export declare const replayVerdict: (outcomes: ReplayOutcome[]) => 'pass' | 'fail' | 'retry' | 'inconclusive'

export declare const hiddenTestEvidence: (
  report: unknown,
  result?: { stderr?: string },
) => { passed: boolean; tests: { name: string; passed: boolean; message: string }[]; text: string }
