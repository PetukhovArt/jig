#!/usr/bin/env node
// Speeds up the stretches of video.mp4 where no narration plays (a step still waits for its actions after the sentence
// ended) by <factor>, keeps the title and every spoken part at 1x, and writes video-fast.mp4. No re-recording.
//   node speed-gaps.mjs <workdir> [factor=3]
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const [dirArg, factorArg = '3'] = process.argv.slice(2)
if (!dirArg) fail('usage: speed-gaps.mjs <workdir> [factor]')
const dir = path.resolve(dirArg)
const FAST = Number(factorArg)
const TITLE_SEC = 3
const TAIL_SEC = 0.4 // 1x a little past the sentence, so its last word is not sped up
const MIN_GAP_SEC = 1
const FFMPEG = tool('ffmpeg')
const FFPROBE = tool('ffprobe')

const json = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
const steps = json('scenario.json').cases.flatMap((c) => c.steps)
// Step starts in the joined capture, written by `fv.mjs assemble`.
const marks = json('timeline.json')
const durations = json('durations.json')
const end = lengthOf(path.join(dir, 'video.mp4'))

const pieces = [[0, TITLE_SEC + marks[steps[0].id], 1]]
steps.forEach((step, i) => {
  const from = TITLE_SEC + marks[step.id]
  const to = i + 1 < steps.length ? TITLE_SEC + marks[steps[i + 1].id] : end
  const said = Math.min(to, from + (step.delay ?? 0) + durations[step.id] + TAIL_SEC)
  if (to - said > MIN_GAP_SEC) pieces.push([from, said, 1], [said, to, FAST])
  else pieces.push([from, to, 1])
})

const filters = pieces.flatMap(([a, b, k], i) => [
  `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${k}[v${i}]`,
  `[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS${k === 1 ? '' : ',' + atempo(k)}[a${i}]`,
])
filters.push(`${pieces.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${pieces.length}:v=1:a=1[v][a]`)
const out = path.join(dir, 'video-fast.mp4')
const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-i', path.join(dir, 'video.mp4'), '-filter_complex', filters.join(';'),
  '-map', '[v]', '-map', '[a]', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-b:a', '128k',
  '-movflags', '+faststart', out], { encoding: 'utf8' })
if (r.status !== 0) fail(r.stderr)
console.log(`${out}: ${end.toFixed(0)} s → ${lengthOf(out).toFixed(0)} s`)

// atempo takes 0.5–2: a larger factor is a chain.
function atempo(k) {
  const f = []
  while (k > 2) { f.push('atempo=2'); k /= 2 }
  f.push(`atempo=${k}`)
  return f.join(',')
}

function lengthOf(file) {
  return Number(spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim())
}

function tool(name) {
  const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Links', `${name}.exe`)
  return spawnSync(name, ['-version']).status === 0 ? name : existsSync(winget) ? winget : fail(`${name} not found`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
