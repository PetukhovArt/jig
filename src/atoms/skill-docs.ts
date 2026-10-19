import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { FrontmatterValue } from '../core/frontmatter'
import { toSlash } from '../core/paths'
import { listMarkdown, listSkillFolders, parseMarkdownFile, readText } from './markdown'

const ROLES_DIR = 'skills/jig/references/roles'
const FLOWS_DIR = 'skills/jig/flows'
const ROLE_KEYS = new Set(['name', 'description', 'metadata'])
const TIERS = ['deep', 'standard', 'fast']
const EFFORTS = ['low', 'medium', 'high']
const MAX_DESCRIPTION_LENGTH = 200
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SKILL_NAME_LENGTH = 64
const ROLE_MENTION = /\b[Rr]oles? `[^`]+`(?:(?:, |,? and |,? or )`[^`]+`)*/g
const BACKTICKED = /`([^`]+)`/g
const FLOW_MENTION = /\bflows\/([A-Za-z0-9_-]+)\.md/g

interface Mention {
  name: string
  file: string
  line: number
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

const findMentions = (file: string, text: string): { roles: Mention[]; flows: Mention[] } => {
  const roles = [...text.matchAll(ROLE_MENTION)].flatMap((match) =>
    [...match[0].matchAll(BACKTICKED)].map((name) => ({ name: name[1] ?? '', file, line: lineAt(text, match.index) })),
  )
  const flows = [...text.matchAll(FLOW_MENTION)].map((match) => ({ name: match[1] ?? '', file, line: lineAt(text, match.index) }))
  return { roles, flows }
}

const listSkillMarkdown = (pluginRoot: string): string[] => {
  try {
    return readdirSync(join(pluginRoot, 'skills'), { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.md'))
      .map((path) => `skills/${toSlash(path)}`)
      .sort()
  } catch {
    return []
  }
}

const checkDescription = (description: FrontmatterValue | undefined): string[] => {
  if (typeof description !== 'string' || description.trim() === '') return ['description is missing']
  if (/[\r\n]/.test(description)) return ['description must be one line']
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return [`description is longer than ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`]
  }
  return []
}

const checkName = (name: FrontmatterValue | undefined, expected: string, source = 'file name'): string[] => {
  if (name === expected) return []
  return typeof name === 'string' && name !== '' ? [`name "${name}" does not match ${source} "${expected}"`] : ['name is missing']
}

const checkMetadata = (metadata: FrontmatterValue | undefined): string[] => {
  if (metadata === undefined || typeof metadata === 'string' || Array.isArray(metadata)) {
    return ['metadata must be a block with tier and effort']
  }
  const choices: [string, readonly string[]][] = [
    ['tier', TIERS],
    ['effort', EFFORTS],
  ]
  return choices
    .filter(([key, allowed]) => !allowed.includes(metadata[key] ?? ''))
    .map(([key, allowed]) => `metadata.${key} must be one of ${allowed.join(', ')}`)
}

const checkDoc = (pluginRoot: string, path: string, isRole: boolean): string[] => {
  const parsed = parseMarkdownFile(readText(join(pluginRoot, path)))
  if (typeof parsed === 'string') return [parsed]
  const { data } = parsed
  const problems = [...checkName(data['name'], basename(path, '.md')), ...checkDescription(data['description'])]
  if (!isRole) return problems
  const unknownKeys = Object.keys(data).filter((key) => !ROLE_KEYS.has(key))
  return [...unknownKeys.map((key) => `unknown frontmatter key "${key}"`), ...problems, ...checkMetadata(data['metadata'])]
}

const checkSkill = (pluginRoot: string, folder: string): string[] => {
  const parsed = parseMarkdownFile(readText(join(pluginRoot, 'skills', folder, 'SKILL.md')))
  const problems = typeof parsed === 'string' ? [parsed] : checkName(parsed.data['name'], folder, 'folder name')
  if (!SKILL_NAME.test(folder) || folder.length > MAX_SKILL_NAME_LENGTH) {
    problems.push(`folder name is not lowercase words joined by hyphens, at most ${MAX_SKILL_NAME_LENGTH} characters`)
  }
  return problems.map((problem) => `skills/${folder}/SKILL.md: ${problem}`)
}

export const validateSkillDocs = (pluginRoot: string): string[] => {
  const roles = listMarkdown(join(pluginRoot, ROLES_DIR)).map((name) => basename(name, '.md'))
  const flows = new Set(listMarkdown(join(pluginRoot, FLOWS_DIR)).map((name) => basename(name, '.md')))
  const mentions = listSkillMarkdown(pluginRoot).map((file) => findMentions(file, readText(join(pluginRoot, file)).replace(/\r\n/g, '\n')))
  const roleMentions = mentions.flatMap((found) => found.roles)
  const referenced = new Set(roleMentions.filter((mention) => !mention.file.startsWith(`${ROLES_DIR}/`)).map((mention) => mention.name))
  const roleErrors = roles.flatMap((name) => {
    const path = `${ROLES_DIR}/${name}.md`
    const problems = checkDoc(pluginRoot, path, true)
    if (!referenced.has(name)) {
      problems.push(`role is never spawned: name it as role \`${name}\` in a flow or reference outside ${ROLES_DIR}/, or delete it`)
    }
    return problems.map((problem) => `${path}: ${problem}`)
  })
  const flowErrors = [...flows].flatMap((name) => {
    const path = `${FLOWS_DIR}/${name}.md`
    return checkDoc(pluginRoot, path, false).map((problem) => `${path}: ${problem}`)
  })
  const roleNames = new Set(roles)
  const mentionErrors = [
    ...roleMentions
      .filter((mention) => !roleNames.has(mention.name))
      .map((mention) => `${mention.file}:${mention.line}: role \`${mention.name}\` does not exist in ${ROLES_DIR}/`),
    ...mentions
      .flatMap((found) => found.flows)
      .filter((mention) => !flows.has(mention.name))
      .map((mention) => `${mention.file}:${mention.line}: flows/${mention.name}.md does not exist in ${FLOWS_DIR}/`),
  ]
  const skillErrors = listSkillFolders(pluginRoot).flatMap((folder) => checkSkill(pluginRoot, folder))
  return [...skillErrors, ...roleErrors, ...flowErrors, ...mentionErrors]
}
