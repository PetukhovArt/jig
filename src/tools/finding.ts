export interface Finding {
  tool: 'jig' | 'oxlint' | 'eslint' | 'tsc' | 'vue-tsc' | 'stratum'
  rule: string
  severity: 'error' | 'warn'
  file: string
  line: number
  message: string
  fix?: string
}
