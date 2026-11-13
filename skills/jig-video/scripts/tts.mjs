import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export const PROJECT_SETTINGS_FILE = path.join('.jig', 'video.json')
const EDGE_TTS_RETRY_PAUSES_SEC = [3, 90, 90]
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|opus|m4a|aac|flac|aiff?)$/i

export function loadProjectSettings(from = process.cwd()) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const file = path.join(dir, PROJECT_SETTINGS_FILE)
    if (existsSync(file)) return { ...JSON.parse(readFileSync(file, 'utf8')), settingsFile: file }
    if (path.dirname(dir) === dir) return {}
  }
}

export function edgeTtsCommand() {
  const pythons = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
  const candidates = [['edge-tts'], ...pythons.map((python) => [python, '-m', 'edge_tts'])]
  return candidates.find(([bin, ...prefix]) => spawnSync(bin, [...prefix, '--help']).status === 0)
}

export function voiceKey(text, settings, step = {}) {
  if (settings.tts) return JSON.stringify(['command', settings.tts, text])
  const pick = (key, neutral) => step[key] ?? settings[key] ?? neutral
  return JSON.stringify(['edge-tts', settings.voice, pick('rate', '+0%'), pick('pitch', '+0Hz'), pick('volume', '+0%'), text])
}

export async function synthesize(text, outBase, settings, step = {}) {
  for (const stale of audioFiles(outBase)) rmSync(stale)
  if (settings.tts) {
    const argv = splitCommand(settings.tts).map((arg) => arg.replaceAll('{text}', text).replaceAll('{out}', outBase))
    const usesTextArg = settings.tts.includes('{text}')
    const r = spawnSync(argv[0], argv.slice(1), { input: usesTextArg ? undefined : text, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`tts command failed:\n${r.stderr || r.error?.message || ''}`)
  } else {
    const [bin, ...prefix] = edgeTtsCommand() ?? fail('edge-tts not found: pipx install edge-tts (or pip install edge-tts), or set "tts" to another command')
    const pick = (key, neutral) => ['--' + key, step[key] ?? settings[key] ?? neutral]
    const args = [...prefix, '--voice', settings.voice ?? fail('no "voice": set it in scenario.json or .jig/video.json'),
      ...pick('rate', '+0%'), ...pick('pitch', '+0Hz'), ...pick('volume', '+0%'), '--text', text, '--write-media', `${outBase}.mp3`]
    let r
    for (const pause of [...EDGE_TTS_RETRY_PAUSES_SEC, undefined]) {
      r = spawnSync(bin, args, { encoding: 'utf8' })
      if (r.status === 0 || pause === undefined) break
      console.log(`edge-tts failed, retrying in ${pause}s`)
      await new Promise((resolve) => setTimeout(resolve, pause * 1000))
    }
    if (r.status !== 0) throw new Error(`edge-tts failed:\n${r.stderr || r.error?.message || ''}`)
  }
  return audioFiles(outBase)[0] ?? fail(`the tts command wrote no ${outBase}.<ext>: put {out} in the output path, e.g. --write-media {out}.mp3`)
}

export function audioFiles(outBase) {
  const dir = path.dirname(outBase)
  const name = path.basename(outBase)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.startsWith(`${name}.`) && AUDIO_EXTENSIONS.test(f)).map((f) => path.join(dir, f))
}

export function splitCommand(command) {
  const args = []
  let current = ''
  let quote
  let hasToken = false
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      hasToken = true
    } else if (/\s/.test(char)) {
      if (hasToken) args.push(current)
      current = ''
      hasToken = false
    } else {
      current += char
      hasToken = true
    }
  }
  if (quote) fail(`tts command: unclosed ${quote}`)
  if (hasToken) args.push(current)
  return args
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
