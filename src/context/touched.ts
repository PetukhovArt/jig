import { existsSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

const MAX_TOKENS = 200
const MAX_PATHS = 20
const SEGMENTS = /[;|&\n]+/
const TOKENS = /[\s<>()]+/
const PATHLIKE = /[\\/]|\.[A-Za-z0-9]{1,8}$/
const GIT_BASH_DRIVE = /^\/([A-Za-z])\/(.*)$/
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm
const MOVE_TO = /^\*\*\* Move to: (.+)$/gm
const INTERPRETER = /^(node|npx|tsx|ts-node|deno|bun|python[0-9.]*|py|ruby|perl|bash|sh|zsh|pwsh|powershell|cmd)(\.exe)?$/i

const unquote = (token: string): string => token.replace(/^['"]+|['"]+$/g, '')

const fromFlag = (token: string): string => {
  const at = token.indexOf('=')
  return token.startsWith('-') && at !== -1 ? token.slice(at + 1) : token
}

const nativePath = (token: string): string => {
  if (process.platform !== 'win32') return token
  const drive = GIT_BASH_DRIVE.exec(token)
  return drive === null ? token : `${drive[1]?.toUpperCase()}:/${drive[2]}`
}

const argumentsOf = (segment: string): string[] => {
  const tokens = segment.split(TOKENS).map(unquote).filter(Boolean)
  const program = tokens[0]
  if (program === undefined) return []
  const rest = tokens.slice(1)
  if (!INTERPRETER.test(basename(program))) return rest
  const script = rest.findIndex((token) => !token.startsWith('-'))
  return script === -1 ? rest : rest.filter((_, index) => index !== script)
}

export const pathsInCommand = (command: string, cwd: string): string[] => {
  const found = new Set<string>()
  const tokens = command.split(SEGMENTS).flatMap(argumentsOf).slice(0, MAX_TOKENS)
  for (const raw of tokens) {
    const token = nativePath(fromFlag(raw))
    if (token === '' || token.startsWith('-') || token.includes('://') || !PATHLIKE.test(token)) continue
    const absolute = isAbsolute(token) ? token : resolve(cwd, token)
    if (existsSync(absolute)) found.add(absolute)
    if (found.size >= MAX_PATHS) break
  }
  return [...found]
}

export const pathsInPatch = (patch: string, cwd: string): string[] => {
  const paths = [...patch.matchAll(PATCH_FILE), ...patch.matchAll(MOVE_TO)].map((match) => (match[1] ?? '').trim())
  return [...new Set(paths.filter(Boolean).map((path) => (isAbsolute(path) ? path : resolve(cwd, path))))]
}
