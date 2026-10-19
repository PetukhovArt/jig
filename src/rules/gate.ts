import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JigConfig, JigRuleId, RuleId } from '../core/config'
import { parseFrontmatter } from '../core/frontmatter'
import { jigPaths, toSlash } from '../core/paths'
import { STATE_MAX_AGE_MS } from '../core/state'
import { addedComments, type AddedComment } from './comments'
import type { Edit } from './rule'
import { findSuppression, isToolDirective } from './suppressions'
import { addedTestCases } from './tests'

export const GATE_ATOMS = ['comments', 'tests'] as const
type GateAtom = (typeof GATE_ATOMS)[number]

export interface GateInput {
  projectRoot: string
  pluginRoot: string
  sessionId: string
  agent: string
  file: string
  edits: readonly Edit[]
  config: JigConfig
}

export interface GateHit {
  rule: RuleId
  line?: number
  message: string
}

export interface GateVerdict {
  reason?: string
  hits: GateHit[]
}

const RETRY = 'Read the rules first, then repeat the same call — it will pass.'
const LEADING_HEADING = /^#[^\n]*\n+/

const isOn = (config: JigConfig, rule: JigRuleId): boolean => (config.rules[rule] ?? 'off') !== 'off'

const sessionDir = (projectRoot: string, sessionId: string): string =>
  join(jigPaths(projectRoot).cache, 'gates', sessionId.replace(/[^A-Za-z0-9._-]/g, '_'))

const claimPath = (projectRoot: string, sessionId: string, agent: string, key: string): string => {
  const name = process.platform === 'win32' ? key.toLowerCase() : key
  return join(sessionDir(projectRoot, sessionId), createHash('sha1').update(`${agent}\n${name}`).digest('hex'))
}

const atomKey = (atom: GateAtom): string => `atom\n${atom}`

const claimFirst = ({ projectRoot, sessionId, agent }: GateInput, key: string): boolean => {
  mkdirSync(sessionDir(projectRoot, sessionId), { recursive: true })
  try {
    writeFileSync(claimPath(projectRoot, sessionId, agent, key), '', { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

const atomPath = (pluginRoot: string, atom: GateAtom): string => toSlash(join(pluginRoot, 'atoms', `${atom}.md`))

const rulesText = (input: GateInput, atom: GateAtom, reminder: string): string => {
  const path = atomPath(input.pluginRoot, atom)
  if (!claimFirst(input, atomKey(atom))) return `${reminder} Rules: ${path}.`
  try {
    const text = readFileSync(path, 'utf8')
    return (parseFrontmatter(text)?.body ?? text).replace(/^\s+/, '').replace(LEADING_HEADING, '').trim()
  } catch {
    return `Rules: ${path}.`
  }
}

const suppressionHits = (file: string, comments: readonly AddedComment[]): GateHit[] =>
  comments.flatMap((comment) => {
    const directive = findSuppression(comment.text)
    if (directive === undefined) return []
    const message = `jig/comments: "${directive}" at ${file}:${comment.line} silences a check. Fix the cause instead; only a human adds suppressions.`
    return [{ rule: 'jig/comments', line: comment.line, message }]
  })

const COMMENT_REMINDER = 'Keep a comment only if it is a license header, a TODO with a ticket, public-API JSDoc beyond the signature, or an external constraint with a link.'

const commentSection = (input: GateInput, comments: readonly AddedComment[]): { text: string; hit: GateHit } | undefined => {
  const gated = comments.filter((comment) => findSuppression(comment.text) === undefined && !isToolDirective(comment.text))
  const unseen = gated.filter((comment) => claimFirst(input, `comment\n${input.file}\n${comment.key}`))
  const [first] = unseen
  if (first === undefined) return undefined
  const list = unseen.map((comment) => `  ${input.file}:${comment.line} ${comment.key}`)
  const head = `jig/comments: the edit adds ${unseen.length} comment(s):\n${list.join('\n')}\n${RETRY} Keep only the comments the rules allow.`
  return {
    text: `${head}\n\n${rulesText(input, 'comments', COMMENT_REMINDER)}`,
    hit: { rule: 'jig/comments', line: first.line, message: `new comment at ${input.file}:${first.line}` },
  }
}

const TEST_REMINDER = 'Finish "this test fails when a developer <edit>, which breaks <behavior>" with a realistic edit, or drop the test.'

const testSection = (input: GateInput): { text: string; hit: GateHit } | undefined => {
  const added = addedTestCases(input.file, input.edits)
  if (added <= 0 || !claimFirst(input, `test\n${input.file}`)) return undefined
  const head = `jig/tests: the edit adds ${added} test case(s) to ${input.file}. ${RETRY}`
  return {
    text: `${head}\n\n${rulesText(input, 'tests', TEST_REMINDER)}`,
    hit: { rule: 'jig/tests', message: `${added} new test case(s) in ${input.file}` },
  }
}

export const gateEdit = (input: GateInput): GateVerdict => {
  const comments = addedComments(input.file, input.edits) ?? []
  const suppressions = suppressionHits(input.file, comments)
  const sections = [
    isOn(input.config, 'jig/comments') ? commentSection(input, comments) : undefined,
    isOn(input.config, 'jig/tests') ? testSection(input) : undefined,
  ].filter((section) => section !== undefined)
  const hits = [...suppressions, ...sections.map((section) => section.hit)]
  if (hits.length === 0) return { hits }
  const texts = [...suppressions.map((hit) => hit.message), ...sections.map((section) => section.text)]
  return { reason: texts.join('\n\n'), hits }
}

export const resetGateAtoms = (projectRoot: string, sessionId: string, agent: string): void => {
  for (const atom of GATE_ATOMS) {
    rmSync(claimPath(projectRoot, sessionId, agent, atomKey(atom)), { force: true })
  }
}

export const pruneGateClaims = (projectRoot: string, now: number = Date.now(), maxAgeMs: number = STATE_MAX_AGE_MS): void => {
  const dir = join(jigPaths(projectRoot).cache, 'gates')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    try {
      if (now - statSync(path).mtimeMs > maxAgeMs) {
        rmSync(path, { recursive: true, force: true })
      }
    } catch {
      continue
    }
  }
}
