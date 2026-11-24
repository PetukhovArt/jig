import { childPath, required, Validator } from '../../core/validator'
import type { AuditFinding, AuditOutcome, AuditTarget } from './result'

export interface StateFiles {
  name: string
  shot?: string
  audit?: string
  failure?: string
}

export interface ComboFiles {
  scaleFactor: number
  failure?: string
  states: StateFiles[]
}

export const SHOT_FILE = 'shot.png'
export const AUDIT_FILE = 'audit.json'
export const COMBO_RESULT_FILE = 'result.json'
export const DEFAULT_STATE = 'screen'

const AUDIT_KINDS = ['layout', 'scene'] as const
const SEVERITIES = ['error', 'warn'] as const
const FILE_KEYS = ['$schema', 'version', 'audits'] as const
const AUDIT_KEYS = ['kind', 'scanned', 'findings', 'note', 'shot'] as const
const FINDING_KEYS = ['rule', 'severity', 'target', 'rect', 'detail'] as const
const TARGET_KEYS = ['testid', 'role', 'name', 'text', 'selector'] as const
const RECT_KEYS = ['x', 'y', 'width', 'height'] as const
const RESULT_KEYS = ['$schema', 'version', 'scaleFactor', 'failure', 'states'] as const
const STATE_KEYS = ['name', 'shot', 'audit', 'failure'] as const

const readTarget = (validator: Validator, value: unknown, path: string): AuditTarget | undefined => {
  const object = validator.object(value, path, TARGET_KEYS)
  if (object === undefined || !required(validator, object, path, ['selector'])) return undefined
  const text = (key: (typeof TARGET_KEYS)[number]): string | undefined => (object[key] === undefined ? undefined : validator.string(object[key], childPath(path, key)))
  const selector = text('selector')
  if (selector === undefined) return undefined
  const [testid, role, name, label] = [text('testid'), text('role'), text('name'), text('text')]
  return {
    selector,
    ...(testid === undefined ? {} : { testid }),
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    ...(label === undefined ? {} : { text: label }),
  }
}

const readRect = (validator: Validator, value: unknown, path: string): AuditFinding['rect'] | undefined => {
  const object = validator.object(value, path, RECT_KEYS)
  if (object === undefined || !required(validator, object, path, [...RECT_KEYS])) return undefined
  const [x, y, width, height] = RECT_KEYS.map((key) => (typeof object[key] === 'number' ? (object[key] as number) : validator.report(childPath(path, key), 'expected a number')))
  return x === undefined || y === undefined || width === undefined || height === undefined ? undefined : { x, y, width, height }
}

const readFinding = (validator: Validator, value: unknown, path: string): AuditFinding | undefined => {
  const object = validator.object(value, path, FINDING_KEYS)
  if (object === undefined || !required(validator, object, path, [...FINDING_KEYS])) return undefined
  const rule = validator.string(object['rule'], childPath(path, 'rule'))
  const severity = validator.oneOf(object['severity'], childPath(path, 'severity'), SEVERITIES)
  const target = readTarget(validator, object['target'], childPath(path, 'target'))
  const rect = readRect(validator, object['rect'], childPath(path, 'rect'))
  const detail = validator.string(object['detail'], childPath(path, 'detail'))
  if (rule === undefined || severity === undefined || target === undefined || rect === undefined || detail === undefined) return undefined
  return { rule, severity, target, rect, detail }
}

const readAudit = (validator: Validator, value: unknown, path: string): AuditOutcome | undefined => {
  const object = validator.object(value, path, AUDIT_KEYS)
  if (object === undefined || !required(validator, object, path, ['kind', 'findings'])) return undefined
  const kind = validator.oneOf(object['kind'], childPath(path, 'kind'), AUDIT_KINDS)
  const list = object['findings']
  if (!Array.isArray(list)) return validator.report(childPath(path, 'findings'), 'expected an array')
  const findings = list.flatMap((finding, index) => readFinding(validator, finding, childPath(childPath(path, 'findings'), index)) ?? [])
  const scanned = object['scanned'] === undefined ? undefined : validator.integer(object['scanned'], childPath(path, 'scanned'), 0)
  const note = object['note'] === undefined ? undefined : validator.string(object['note'], childPath(path, 'note'))
  const shot = object['shot'] === undefined ? undefined : validator.string(object['shot'], childPath(path, 'shot'))
  if (kind === undefined) return undefined
  return {
    kind,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warn').length,
    ...(scanned === undefined ? {} : { scanned }),
    findings,
    ...(note === undefined ? {} : { note }),
    ...(shot === undefined ? {} : { shot }),
  }
}

const parseJson = (text: string): { value?: unknown; errors: string[] } => {
  try {
    return { value: JSON.parse(text), errors: [] }
  } catch (error) {
    return { errors: [`$: not JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

export const parseAudit = (text: string): { audits?: AuditOutcome[]; errors: string[] } => {
  const json = parseJson(text)
  if (json.errors.length > 0) return { errors: json.errors }
  const validator = new Validator()
  const object = validator.object(json.value, '$', FILE_KEYS)
  if (object === undefined || !required(validator, object, '$', ['version', 'audits'])) return { errors: validator.errors }
  if (object['version'] !== 1) validator.report('$.version', 'expected 1')
  const list = object['audits']
  if (!Array.isArray(list) || list.length === 0) validator.report('$.audits', 'expected a non-empty array')
  const audits = Array.isArray(list) ? list.flatMap((audit, index) => readAudit(validator, audit, childPath('$.audits', index)) ?? []) : []
  return validator.errors.length > 0 ? { errors: validator.errors } : { audits, errors: [] }
}

export const parseComboResult = (text: string): { result?: ComboFiles; errors: string[] } => {
  const json = parseJson(text)
  if (json.errors.length > 0) return { errors: json.errors }
  const validator = new Validator()
  const object = validator.object(json.value, '$', RESULT_KEYS)
  if (object === undefined || !required(validator, object, '$', ['version'])) return { errors: validator.errors }
  if (object['version'] !== 1) validator.report('$.version', 'expected 1')
  let scaleFactor = 1
  if (object['scaleFactor'] !== undefined) {
    if (typeof object['scaleFactor'] === 'number' && object['scaleFactor'] > 0) scaleFactor = object['scaleFactor']
    else validator.report('$.scaleFactor', 'expected a number > 0')
  }
  const failure = object['failure'] === undefined ? undefined : validator.string(object['failure'], '$.failure')
  const states: StateFiles[] = []
  if (object['states'] === undefined) {
    states.push({ name: DEFAULT_STATE, shot: SHOT_FILE, audit: AUDIT_FILE })
  } else if (!Array.isArray(object['states']) || object['states'].length === 0) {
    validator.report('$.states', 'expected a non-empty array')
  } else {
    object['states'].forEach((raw, index) => {
      const path = childPath('$.states', index)
      const state = validator.object(raw, path, STATE_KEYS)
      if (state === undefined || !required(validator, state, path, ['name'])) return
      const text = (key: 'name' | 'shot' | 'audit' | 'failure'): string | undefined => (state[key] === undefined ? undefined : validator.string(state[key], childPath(path, key)))
      const name = text('name')
      const [shot, audit, stateFailure] = [text('shot'), text('audit'), text('failure')]
      if (name === undefined) return
      if (stateFailure === undefined && (shot === undefined || audit === undefined)) validator.report(path, 'expected shot and audit, or a failure')
      states.push({ name, ...(shot === undefined ? {} : { shot }), ...(audit === undefined ? {} : { audit }), ...(stateFailure === undefined ? {} : { failure: stateFailure }) })
    })
  }
  if (validator.errors.length > 0) return { errors: validator.errors }
  return { result: { scaleFactor, ...(failure === undefined ? {} : { failure }), states }, errors: [] }
}
