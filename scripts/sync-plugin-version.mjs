import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packagePath = join(root, 'package.json')
const pluginPath = join(root, '.claude-plugin', 'plugin.json')
const isCheck = process.argv.includes('--check')

const versionLine = /("version"\s*:\s*")([^"]*)(")/

const { version } = JSON.parse(readFileSync(packagePath, 'utf8'))
const pluginText = readFileSync(pluginPath, 'utf8')
const pluginVersion = JSON.parse(pluginText).version

if (pluginVersion === version) {
  process.exit(0)
}

if (isCheck) {
  process.stderr.write(`.claude-plugin/plugin.json version ${pluginVersion} differs from package.json ${version}, run node scripts/sync-plugin-version.mjs\n`)
  process.exit(1)
}

writeFileSync(pluginPath, pluginText.replace(versionLine, `$1${version}$3`))
process.stdout.write(`.claude-plugin/plugin.json version ${pluginVersion} -> ${version}\n`)
