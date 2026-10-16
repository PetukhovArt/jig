import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const jigRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const SNIPPET_MAX = 160
const LINE_BREAK = /\r?\n/

const [repoArg] = process.argv.slice(2)
if (repoArg === undefined) {
  process.stderr.write('usage: node bench/false-positives.mjs <repo>\n')
  process.exit(2)
}
const repo = resolve(repoArg)

const loadRules = async () => {
  const result = await build({
    stdin: {
      contents: [
        "export { checkComments } from './src/rules/comments'",
        "export { checkSuppressions } from './src/rules/suppressions'",
        "export { defaultConfig } from './src/core/config'",
      ].join('\n'),
      resolveDir: jigRoot,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    logLevel: 'warning',
  })
  const dir = mkdtempSync(join(tmpdir(), 'jig-false-positives-'))
  const bundlePath = join(dir, 'rules.mjs')
  writeFileSync(bundlePath, result.outputFiles[0].text)
  try {
    return await import(pathToFileURL(bundlePath).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const { checkComments, checkSuppressions, defaultConfig } = await loadRules()
const config = defaultConfig()

const files = execFileSync('git', ['ls-files', '-z', '--', '*.ts', '*.vue'], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  .split('\0')
  .filter((file) => file !== '')

const hits = []
const lexerErrors = []
for (const file of files) {
  let source
  try {
    source = readFileSync(join(repo, file), 'utf8')
  } catch {
    continue
  }
  const edits = [{ before: '', after: source, line: 1 }]
  const lines = source.split(LINE_BREAK)
  try {
    for (const finding of [...checkSuppressions(file, edits, config), ...checkComments(file, edits, config)]) {
      hits.push({ file, line: finding.line, rule: finding.rule, text: (lines[finding.line - 1] ?? '').trim().slice(0, SNIPPET_MAX) })
    }
  } catch (error) {
    lexerErrors.push({ file, message: error instanceof Error ? error.message : String(error) })
  }
}

hits.sort((left, right) => left.rule.localeCompare(right.rule) || left.file.localeCompare(right.file) || left.line - right.line)
for (const hit of hits) {
  process.stdout.write(`${hit.file}:${hit.line} [${hit.rule}] ${hit.text}\n`)
}
for (const failure of lexerErrors) {
  process.stdout.write(`${failure.file} [lexer error] ${failure.message}\n`)
}

const perRule = new Map()
for (const hit of hits) {
  perRule.set(hit.rule, (perRule.get(hit.rule) ?? 0) + 1)
}
const filesWithHits = new Set(hits.map((hit) => hit.file)).size
const totals = [...perRule].map(([rule, count]) => `${rule} ${count}`).join(', ') || 'no hits'
process.stdout.write(`\nscanned ${files.length} .ts/.vue files in ${repo}, ${filesWithHits} with hits: ${totals}; lexer errors ${lexerErrors.length}\n`)
