import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(root, 'bin', 'jig.mjs')
const atomsDir = join(root, 'atoms')
const skillDir = join(root, 'skills', 'jig')
const rolesDir = join(skillDir, 'references', 'roles')
const roleIndexPath = join(skillDir, 'references', 'roles.md')
const flowsDir = join(skillDir, 'flows')
const skillPath = join(skillDir, 'SKILL.md')
const skillsDir = join(root, 'skills')
const readmePath = join(root, 'README.md')
const README_BLOCKS = ['flows', 'skills', 'atoms', 'roles']
const FLOWS_START = '<!-- flows:start -->'
const FLOWS_END = '<!-- flows:end -->'
const ATOMS_START = '<!-- atoms:start -->'
const ATOMS_END = '<!-- atoms:end -->'
const ATOM_GROUPS = ['Process', 'Design', 'Code', 'Proof', 'Review']
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

const triggerOf = (file, description) => {
  const match = /^(.*?)\.(\s|$)/.exec(description)
  if (!match) throw new Error(`atoms/${file}: description needs a first sentence ending with a period`)
  return match[1]
}

const atomIndexLines = () => {
  const atoms = readEntries(atomsDir, 'atoms').map(({ file, name, description, metadata }) => {
    const group = metadata?.group
    if (!ATOM_GROUPS.includes(group)) {
      throw new Error(`atoms/${file}: metadata.group must be one of ${ATOM_GROUPS.join(', ')}`)
    }
    return { group, line: `- \`${name}\`: ${triggerOf(file, description)}` }
  })
  return ATOM_GROUPS.flatMap((group) => {
    const lines = atoms.filter((atom) => atom.group === group).map((atom) => atom.line)
    return lines.length === 0 ? [] : ['', `**${group}**`, ...lines]
  }).slice(1)
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

const replaceBlock = (text, startMarker, endMarker, lines, label = 'skills/jig/SKILL.md') => {
  const start = text.indexOf(`${startMarker}\n`)
  const end = text.indexOf(`${endMarker}\n`)
  if (start === -1 || end < start) {
    throw new Error(`${label}: needs the lines ${startMarker} and ${endMarker}, in that order`)
  }
  return [text.slice(0, start), startMarker, '\n', ...lines.map((line) => `${line}\n`), text.slice(end)].join('')
}

const cell = (text) => text.replaceAll('|', '\\|')

const details = (summary, lines) => ['', `<details><summary><b>${summary}</b></summary>`, '', ...lines, '', '</details>', '']

const readmeFlows = () => {
  const flows = readEntries(flowsDir, 'flows').filter(({ name }) => name !== SHARED_FLOW)
  return details(`All ${flows.length} flows`, [
    '| flow | for |',
    '| --- | --- |',
    ...flows.map(({ file, name, description }) => `| [${name}](skills/jig/flows/${file}) | ${cell(description)} |`),
  ])
}

const readmeSkills = () => {
  const skills = readdirSync(skillsDir)
    .filter((dir) => existsSync(join(skillsDir, dir, 'SKILL.md')))
    .sort()
    .map((dir) => ({ dir, ...readFrontmatter(readFileSync(join(skillsDir, dir, 'SKILL.md'), 'utf8')) }))
  return details(`All ${skills.length} skills`, [
    '| skill | started by | what it does |',
    '| --- | --- | --- |',
    ...skills.map(({ dir, name, description, ['disable-model-invocation']: userOnly }) => {
      const codexPolicy = join(skillsDir, dir, 'agents', 'openai.yaml')
      if (userOnly === 'true' && !(existsSync(codexPolicy) && /allow_implicit_invocation:\s*false/.test(readFileSync(codexPolicy, 'utf8')))) {
        throw new Error(`skills/${dir}: disable-model-invocation needs agents/openai.yaml with allow_implicit_invocation: false, the key Codex reads`)
      }
      const startedBy = userOnly === 'true' ? 'you' : 'you or the model'
      const what = description.replace(/\s+Use (for|when) .*$/, '')
      return `| [\`/${name}\`](skills/${dir}/SKILL.md) | ${startedBy} | ${cell(what)} |`
    }),
  ])
}

const readmeAtoms = () => {
  const atoms = readEntries(atomsDir, 'atoms')
    .map(({ file, name, description, metadata }) => ({ file, name, group: metadata?.group, when: triggerOf(file, description) }))
    .sort((a, b) => ATOM_GROUPS.indexOf(a.group) - ATOM_GROUPS.indexOf(b.group))
  return details(`All ${atoms.length} atoms`, [
    '| atom | group | apply |',
    '| --- | --- | --- |',
    ...atoms.map(({ file, name, group, when }) => `| [${name}](atoms/${file}) | ${group.toLowerCase()} | ${cell(when.replace(/^Apply /, ''))} |`),
  ])
}

const readmeRoles = () => {
  const roles = readEntries(rolesDir, 'roles')
  return details(`All ${roles.length} roles`, [
    '| role | tier / effort | when |',
    '| --- | --- | --- |',
    ...roles.map(({ file, name, description, metadata }) =>
      `| [${name}](skills/jig/references/roles/${file}) | ${metadata?.tier}/${metadata?.effort} | ${cell(description)} |`),
  ])
}

const readmeWithIndexes = () => {
  const generators = { flows: readmeFlows, skills: readmeSkills, atoms: readmeAtoms, roles: readmeRoles }
  return README_BLOCKS.reduce(
    (text, block) => replaceBlock(text, `<!-- ${block}:start -->`, `<!-- ${block}:end -->`, generators[block](), 'README.md'),
    normalizeEol(readFileSync(readmePath, 'utf8')),
  )
}

const skillWithIndexes = () => {
  const text = normalizeEol(readFileSync(skillPath, 'utf8'))
  const flowLines = readEntries(flowsDir, 'flows')
    .filter(({ name }) => name !== SHARED_FLOW)
    .map(({ name, description }) => `- \`${name}\`: ${description}`)
  const withAtoms = replaceBlock(text, ATOMS_START, ATOMS_END, atomIndexLines())
  return replaceBlock(withAtoms, FLOWS_START, FLOWS_END, flowLines)
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
    [roleIndexPath, roleIndex()],
    [skillPath, skillWithIndexes()],
    [readmePath, readmeWithIndexes()],
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
