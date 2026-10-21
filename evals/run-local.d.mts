export interface UiCheckConfig {
  start: string
  stop?: string
  restore?: string
  reset?: string
  replay: string
  final_steps?: string[]
  patch?: string
  store?: string
  store_sections?: string[]
  acts?: string[]
  env?: string
  replay_timeout_seconds?: number
}

export interface UiCheck {
  replay: string
  verdict: 'pass' | 'fail' | 'inconclusive'
  error?: string
  attempts: { outcome: string; exitCode: number | null; output: string; screenshot?: string }[]
  screenshots: string[]
  start?: { exitCode: number | null; output: string }
  stop?: { exitCode: number | null; output: string }
  restore?: { exitCode: number | null; output: string }
  text: string
}

export interface EvalCase {
  name: string
  dir: string
  hiddenTests?: { dir: string; command?: string; filter?: string }
  ui?: UiCheckConfig
}

export declare const runHiddenTests: (testCase: EvalCase, runDir: string, tempDir: string) => Promise<{ passed: boolean; command: string; text: string }>

export declare const runUiCheck: (testCase: EvalCase, runDir: string, tempDir: string, outDir: string, id: string) => Promise<UiCheck>

export declare const withApp: <T>(task: () => Promise<T>) => Promise<T>
