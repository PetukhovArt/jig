import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(root, 'bin', 'jig.mjs')
const atomsDir = join(root, 'atoms')
const skillDir = join(root, 'skills', 'jig')
const atomIndexPath = join(skillDir, 'references', 'atoms.md')
const rolesDir = join(skillDir, 'references', 'roles')
const roleIndexPath = join(skillDir, 'references', 'roles.md')
const flowsDir = join(skillDir, 'flows')
const skillPath = join(skillDir, 'SKILL.md')
const FLOWS_START = '<!-- flows:start -->'
const FLOWS_END = '<!-- flows:end -->'
const SHARED_FLOW = 'mr'
const isCheck = process.argv.includes('--check')

const normalizeEol = (text) => text.replace(/\r\n/g, '\n')

const bundle = async () => {
  const result = await build({
    entryPoints: [join(root, 'src', 'cli', 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: bundlePath,
    banner: { js: '#!/usr/bin/env node' },
    loader: { '.html': 'text' },
    minify: false,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  })
  const [output] = result.outputFiles
  return output.text
}

const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2')

const readFrontmatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---(\n|$)/.exec(normalizeEol(text))
  if (!match) return {}
  const fields = {}
  let blockKey
  for (const line of match[1].split('\n')) {
    const nested = /^\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (nested && blockKey) {
      const map = typeof fields[blockKey] === 'object' ? fields[blockKey] : {}
      map[nested[1]] = unquote(nested[2])
      fields[blockKey] = map
      continue
    }
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    fields[pair[1]] = unquote(pair[2])
    blockKey = fields[pair[1]] === '' ? pair[1] : undefined
  }
  return fields
}

const listMarkdown = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.md')).sort() : []

const readEntries = (dir, label) =>
  listMarkdown(dir).map((file) => {
    const fields = readFrontmatter(readFileSync(join(dir, file), 'utf8'))
    if (!fields.name || !fields.description) {
      throw new Error(`${label}/${file}: frontmatter lacks name or description`)
    }
    return { file, ...fields }
  })

const atomIndex = () => {
  const lines = readEntries(atomsDir, 'atoms').map(
    ({ file, name, description }) => `- \`${name}\` (\`atoms/${file}\`): ${description}`,
  )
  return ['# Atom index', '', ...lines].join('\n').trimEnd() + '\n'
}

const roleIndex = () => {
  const lines = readEntries(rolesDir, 'roles').map(({ file, name, description, metadata }) => {
    const { tier, effort } = metadata ?? {}
    if (!tier || !effort) {
      throw new Error(`roles/${file}: frontmatter lacks metadata.tier or metadata.effort`)
    }
    return `- \`${name}\` (\`skills/jig/references/roles/${file}\`, ${tier}/${effort}): ${description}`
  })
  return ['# Role index', '', ...lines].join('\n').trimEnd() + '\n'
}

const skillWithFlowIndex = () => {
  const text = normalizeEol(readFileSync(skillPath, 'utf8'))
  const start = text.indexOf(`${FLOWS_START}\n`)
  const end = text.indexOf(`${FLOWS_END}\n`)
  if (start === -1 || end < start) {
    throw new Error(`skills/jig/SKILL.md: needs the lines ${FLOWS_START} and ${FLOWS_END}, in that order`)
  }
  const lines = readEntries(flowsDir, 'flows')
    .filter(({ name }) => name !== SHARED_FLOW)
    .map(({ name, description }) => `- \`${name}\`: ${description}`)
  return [text.slice(0, start), FLOWS_START, '\n', ...lines.map((line) => `${line}\n`), text.slice(end)].join('')
}

const isStale = (path, expected) => {
  if (!existsSync(path)) return true
  return normalizeEol(readFileSync(path, 'utf8')) !== normalizeEol(expected)
}

const writeOutput = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const main = async () => {
  const outputs = [
    [bundlePath, await bundle()],
    [atomIndexPath, atomIndex()],
    [roleIndexPath, roleIndex()],
    [skillPath, skillWithFlowIndex()],
  ]

  if (isCheck) {
    const stale = outputs.filter(([path, text]) => isStale(path, text)).map(([path]) => relative(root, path).replaceAll('\\', '/'))
    if (stale.length > 0) {
      process.stderr.write(`${stale.join(', ')} stale, run npm run build\n`)
      return 1
    }
    return 0
  }

  for (const [path, text] of outputs) {
    writeOutput(path, text)
  }
  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(`build: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
}
