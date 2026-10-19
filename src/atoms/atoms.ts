import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseFrontmatter, type FrontmatterValue } from '../core/frontmatter'
import { ensureJigDir, resolvePluginRoot, resolveProjectRoot } from '../core/paths'
import { buildPlan, readAtomIndex, writePlan } from '../core/plan'
import { GATE_ATOMS } from '../rules/gate'
import { listMarkdown, parseMarkdownFile, readText } from './markdown'
import { validateSkillDocs } from './skill-docs'

type Command = (args: string[]) => number | Promise<number>

const ALLOWED_KEYS = new Set(['name', 'description', 'metadata', 'paths'])
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DESCRIPTION_START = /^Apply (when|before|after|to) /
const MAX_DESCRIPTION_LENGTH = 300
const MAX_BODY_LINES = 35
const ATOMS_LINE = /^\s*Atoms:(.*)$/gm
const INDEX_LINE = /^\s*- `([a-z0-9-]+)`/gm

const reachableNames = (pluginRoot: string): Set<string> => {
  const skillDir = join(pluginRoot, 'skills', 'jig')
  const flowsDir = join(skillDir, 'flows')
  const texts = [
    readText(join(skillDir, 'SKILL.md')),
    ...listMarkdown(flowsDir).map((name) => readText(join(flowsDir, name))),
  ].map((text) => text.replace(/\r\n/g, '\n'))
  const names = new Set<string>(GATE_ATOMS)
  for (const text of texts) {
    for (const match of text.matchAll(/atom `([^`]+)`/g)) {
      names.add(match[1] ?? '')
    }
    for (const match of text.matchAll(INDEX_LINE)) {
      names.add(match[1] ?? '')
    }
    for (const match of text.matchAll(ATOMS_LINE)) {
      for (const item of (match[1] ?? '').split(',')) {
        names.add(item.trim().replace(/[`.]/g, ''))
      }
    }
  }
  return names
}

const bodyLineCount = (body: string): number => {
  const trimmed = body.replace(/\s+$/, '')
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

const checkName = (name: FrontmatterValue | undefined, fileName: string, seen: Set<string>): string[] => {
  if (typeof name !== 'string' || name === '') return ['name is missing']
  const problems: string[] = []
  if (name !== fileName) {
    problems.push(`name "${name}" does not match file name "${fileName}"`)
  }
  if (!KEBAB_CASE.test(name)) {
    problems.push(`name "${name}" is not kebab-case`)
  }
  if (seen.has(name)) {
    problems.push(`duplicate name "${name}"`)
  }
  seen.add(name)
  return problems
}

const checkDescription = (description: FrontmatterValue | undefined): string[] => {
  if (typeof description !== 'string' || description === '') return ['description is missing']
  const problems: string[] = []
  if (!DESCRIPTION_START.test(description)) {
    problems.push(`description must match ${DESCRIPTION_START.source}`)
  }
  if (/[\r\n]/.test(description)) {
    problems.push('description must be one line')
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    problems.push(`description is longer than ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`)
  }
  return problems
}

const checkAtom = (path: string, seen: Set<string>, reachable: Set<string>): string[] => {
  const fileName = basename(path, '.md')
  const parsed = parseMarkdownFile(readText(path))
  if (typeof parsed === 'string') return [parsed]
  const { data, body } = parsed
  const unknownKeys = Object.keys(data).filter((key) => !ALLOWED_KEYS.has(key))
  const problems = unknownKeys.map((key) => `unknown frontmatter key "${key}"`)
  problems.push(...checkName(data['name'], fileName, seen), ...checkDescription(data['description']))
  const lineCount = bodyLineCount(body)
  if (lineCount > MAX_BODY_LINES) {
    problems.push(`body is longer than ${MAX_BODY_LINES} lines (${lineCount})`)
  }
  const name = typeof data['name'] === 'string' ? data['name'] : fileName
  if (!reachable.has(name)) {
    problems.push(`atom is unreachable: name it as atom \`${name}\`, in an "Atoms:" line or an index line of skills/jig/SKILL.md or a flow, or deliver it from a hook gate`)
  }
  return problems
}

export const validateAtoms = (pluginRoot: string): string[] => {
  const dir = join(pluginRoot, 'atoms')
  const reachable = reachableNames(pluginRoot)
  const seen = new Set<string>()
  return listMarkdown(dir).flatMap((name) =>
    checkAtom(join(dir, name), seen, reachable).map((problem) => `atoms/${name}: ${problem}`),
  )
}

const readAtomBody = (file: string): string => {
  const text = readFileSync(file, 'utf8')
  const body = parseFrontmatter(text)?.body ?? text.replace(/\r\n/g, '\n')
  return body.replace(/^\n+/, '').replace(/\s+$/, '')
}

const BUILD_FLAGS = new Set(['--atoms-only', '--check'])

export const runBuild: Command = (args) => {
  const unknown = args.find((arg) => !BUILD_FLAGS.has(arg))
  if (unknown !== undefined) {
    process.stderr.write(`jig: unknown argument ${unknown}, expected --atoms-only or --check\n`)
    return 2
  }
  const pluginRoot = resolvePluginRoot()
  const errors = [...validateAtoms(pluginRoot), ...validateSkillDocs(pluginRoot)]
  if (errors.length > 0) {
    process.stdout.write(`${errors.join('\n')}\n`)
    return 1
  }
  const isPlanWritten = !args.includes('--atoms-only') && !args.includes('--check')
  if (isPlanWritten) {
    const projectRoot = resolveProjectRoot(process.cwd())
    ensureJigDir(projectRoot)
    writePlan(projectRoot, buildPlan(projectRoot, pluginRoot))
  }
  process.stdout.write('ok\n')
  return 0
}

export const runAtom: Command = (args) => {
  const [name, ...rest] = args
  if (name === undefined || rest.length > 0) {
    process.stderr.write('jig: usage: jig atom <name>\n')
    return 2
  }
  const atom = readAtomIndex(resolvePluginRoot()).find((candidate) => candidate.name === name)
  if (atom === undefined) {
    process.stderr.write(`jig: unknown atom ${name}\n`)
    return 1
  }
  process.stdout.write(`${readAtomBody(atom.file)}\n`)
  return 0
}
