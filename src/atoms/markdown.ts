import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FrontmatterError, parseFrontmatter, type Frontmatter } from '../core/frontmatter'

export const listMarkdown = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .sort()
  } catch {
    return []
  }
}

export const listSkillFolders = (pluginRoot: string): string[] => {
  try {
    return readdirSync(join(pluginRoot, 'skills'))
      .filter((name) => existsSync(join(pluginRoot, 'skills', name, 'SKILL.md')))
      .sort()
  } catch {
    return []
  }
}

export const readText =(path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export const parseMarkdownFile = (text: string): Frontmatter | string => {
  try {
    return parseFrontmatter(text) ?? 'frontmatter is missing'
  } catch (error) {
    if (error instanceof FrontmatterError) return `frontmatter is invalid (${error.message})`
    throw error
  }
}
