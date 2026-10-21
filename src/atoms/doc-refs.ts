import { existsSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { toSlash } from '../core/paths'
import { listMarkdown, listSkillFolders, readText } from './markdown'

const FLOWS_DIR = 'skills/jig/flows'
const SHARED_FLOW = 'mr'
const SLASH = /(?<=^|[\s`(|"'>])\/(jig(?:[:-][a-z0-9-]+)*)(?![\w/.-])/gm
const LINK = /\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g
const BACKTICKED_PATH = /`((?:skills|references|scripts|agents)\/[^`\s]+)/g
const SKILL_RELATIVE = /^(?:references|scripts|agents)\//
const PLACEHOLDER = /[<>*{}[\]]/
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const FLOW_ROW = /^\| \[[^\]]+\]\((?:\.\/)?skills\/jig\/flows\/([\w-]+)\.md\)/gm

interface Doc {
  file: string
  text: string
}

const listNested = (pluginRoot: string, dir: string): string[] => {
  try {
    return readdirSync(join(pluginRoot, dir), { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.md'))
      .map((path) => `${dir}/${toSlash(path)}`)
  } catch {
    return []
  }
}

const exists = (pluginRoot: string, path: string): boolean => existsSync(join(pluginRoot, path))

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

const skillOf = (command: string): string => {
  const [plugin, skill] = command.split(':')
  return skill ?? plugin ?? ''
}

const skillRoot = (file: string): string | undefined => /^skills\/[^/]+/.exec(file)?.[0]

const checkSlashCommands = ({ file, text }: Doc, skills: Set<string>): string[] =>
  [...text.matchAll(SLASH)]
    .filter((match) => !skills.has(skillOf(match[1] ?? '')))
    .map((match) => `${file}:${lineAt(text, match.index)}: /${match[1]} names no skill in skills/`)

const checkLinks = ({ file, text }: Doc, pluginRoot: string): string[] =>
  [...text.matchAll(LINK)].flatMap((match) => {
    const target = (match[1] ?? '').split('#')[0] ?? ''
    if (target === '' || URL_SCHEME.test(target)) return []
    const path = posix.normalize(posix.join(posix.dirname(file), decodeURI(target)))
    return exists(pluginRoot, path) ? [] : [`${file}:${lineAt(text, match.index)}: link ${target} points at no file`]
  })

const checkBacktickedPaths = ({ file, text }: Doc, pluginRoot: string): string[] =>
  [...text.matchAll(BACKTICKED_PATH)].flatMap((match) => {
    const path = match[1] ?? ''
    if (PLACEHOLDER.test(path)) return []
    const root = SKILL_RELATIVE.test(path) ? skillRoot(file) : ''
    if (root === undefined) return []
    const resolved = root === '' ? path : `${root}/${path}`
    return exists(pluginRoot, resolved) ? [] : [`${file}:${lineAt(text, match.index)}: \`${path}\` points at no file`]
  })

const checkFlowTable = ({ file, text }: Doc, pluginRoot: string): string[] => {
  const rows = file === 'README.md' ? [...text.matchAll(FLOW_ROW)] : []
  const [first] = rows
  if (first === undefined) return []
  const listed = new Set(rows.map((row) => row[1] ?? ''))
  const line = lineAt(text, first.index)
  return listMarkdown(join(pluginRoot, FLOWS_DIR))
    .map((name) => name.slice(0, -'.md'.length))
    .filter((name) => name !== SHARED_FLOW && !listed.has(name))
    .map((name) => `${file}:${line}: flow ${name} is missing from the flow table`)
}

/** Reports slash commands, links and backticked paths that name nothing the plugin ships, and a flow missing from the README flow table. */
export const validateDocRefs = (pluginRoot: string): string[] => {
  const skills = new Set(listSkillFolders(pluginRoot))
  const readme = exists(pluginRoot, 'README.md') ? ['README.md'] : []
  const files = [...readme, ...listNested(pluginRoot, 'docs'), ...listNested(pluginRoot, 'skills')].sort()
  return files.flatMap((file) => {
    const doc = { file, text: readText(join(pluginRoot, file)).replace(/\r\n/g, '\n') }
    return [
      ...checkSlashCommands(doc, skills),
      ...checkLinks(doc, pluginRoot),
      ...checkBacktickedPaths(doc, pluginRoot),
      ...checkFlowTable(doc, pluginRoot),
    ]
  })
}
