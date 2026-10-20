export interface CheckError {
  file: string
  line: number
  column: number
  code: string
  message: string
}

export declare const parseTsc: (output: string, root: string) => CheckError[]

export declare const parseEslint: (
  report: { filePath: string; messages: { line?: number; column?: number; ruleId?: string | null; message: string; severity: number }[] }[],
  root: string,
) => CheckError[]

export declare const errorKey: (error: CheckError) => string

export declare const newErrors: (errors: CheckError[], baseErrors: CheckError[], isChanged: (error: CheckError) => boolean) => CheckError[]

export declare const cachedBaseErrors: (baseRoot: string, tool: string, files: string[], check: () => CheckError[]) => CheckError[]
