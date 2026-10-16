import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(root, 'bin', 'jig.mjs')
const atomsDir = join(root, 'atoms')
const atomIndexPath = join(root, 'skills', 'jig', 'references', 'atoms.md')
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

const readFrontmatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---(\n|$)/.exec(normalizeEol(text))
  if (!match) return {}
  const fields = {}
  for (const line of match[1].split('\n')) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    fields[pair[1]] = pair[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return fields
}

const atomIndex = () => {
  const files = existsSync(atomsDir)
    ? readdirSync(atomsDir).filter((file) => file.endsWith('.md')).sort()
    : []
  const lines = files.map((file) => {
    const { name, description } = readFrontmatter(readFileSync(join(atomsDir, file), 'utf8'))
    if (!name || !description) {
      throw new Error(`atoms/${file}: frontmatter lacks name or description`)
    }
    return `- \`${name}\` (\`atoms/${file}\`): ${description}`
  })
  return ['# Atom index', '', ...lines].join('\n').trimEnd() + '\n'
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
  ]

  if (isCheck) {
    const hasStale = outputs.some(([path, text]) => isStale(path, text))
    if (hasStale) {
      process.stderr.write('bin/jig.mjs or references/atoms.md is stale, run npm run build\n')
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
