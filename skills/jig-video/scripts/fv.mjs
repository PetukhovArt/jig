#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { attachVideo } from './attach.mjs'
import { audioFiles, edgeTtsCommand, loadProjectSettings, synthesize, voiceKey } from './tts.mjs'
import { captureInput, pinWindow, placeWindows, platformRequirements, windowClientArea } from './window.mjs'

const [cmd, dirArg, ...rest] = process.argv.slice(2)
if (cmd === 'check') checkRequirements()
if (cmd === 'window') {
  console.log(await windowAction(process.argv.slice(3)))
  process.exit(0)
}
if (cmd === 'say') {
  const [text, out] = process.argv.slice(3)
  if (!text || !out) fail('usage: fv.mjs say "<text>" <out path without extension>')
  console.log(await synthesize(text, path.resolve(out), loadProjectSettings()))
  process.exit(0)
}
if (!cmd || !dirArg) fail('usage: fv.mjs narrate <workdir>\n       fv.mjs record <workdir> --case <caseId> [--window "title" [--inner WxH]] [--region x,y,w,h] [--cursor]   (runs until stop: start it in the background)\n       fv.mjs mark <workdir> <stepId>\n       fv.mjs stop <workdir>\n       fv.mjs viewport <workdir> <innerWidth>x<innerHeight>@<devicePixelRatio> [--check]\n       fv.mjs assemble <workdir>\n       fv.mjs attach <workdir> [--to <PR/MR number or url>] [--file video-fast.mp4] [--dry-run]\n       fv.mjs say "<text>" <out>\n       fv.mjs check\n       fv.mjs window <place|pin> [flags] [--inner WxH]')
const dir = path.resolve(dirArg)
const positional = rest[0] === undefined || rest[0].startsWith('--') ? undefined : rest[0]
const flags = {}
const flagArgs = positional === undefined ? rest : rest.slice(1)
for (let i = 0; i < flagArgs.length; i++) {
  const hasValue = flagArgs[i + 1] !== undefined && !flagArgs[i + 1].startsWith('--')
  flags[flagArgs[i].replace(/^--/, '')] = hasValue ? flagArgs[++i] : true
}

const TITLE_SEC = 3
const GAP_SEC = 0.6
const CONTROL = { state: 'capture.json', marks: 'capture-marks.jsonl', stop: 'capture.stop' }
const FFMPEG = findTool('ffmpeg')
const FFPROBE = findTool('ffprobe')

const scenario = { ...loadProjectSettings(), ...readJson('scenario.json') }
// Each use case is recorded into its own clip, so a failed case is re-recorded alone; assemble joins them.
const cases = scenario.cases ?? fail('scenario.json: no "cases". Steps live in cases: "cases": [{ "id": "…", "setup": […], "steps": […] }]')
const steps = cases.flatMap((c) => c.steps)
const duplicate = steps.find((s, i) => steps.findIndex((t) => t.id === s.id) !== i)
if (duplicate) fail(`scenario.json: step id ${duplicate.id} is used twice`)
const capturePath = (caseId) => path.join(dir, 'cases', `${caseId}.mkv`)
const commands = { narrate, record, mark, stop, viewport, assemble, attach }
await (commands[cmd] ?? (() => fail(`unknown command ${cmd}`)))()

async function narrate() {
  mkdirSync(path.join(dir, 'audio'), { recursive: true })
  const durations = {}
  for (const step of steps) {
    const outBase = path.join(dir, 'audio', step.id)
    const voicedWith = voiceKey(step.say, scenario, step)
    const keyFile = `${outBase}.key`
    const cached = existsSync(keyFile) && readFileSync(keyFile, 'utf8') === voicedWith ? audioFiles(outBase)[0] : undefined
    const file = cached ?? await synthesize(step.say, outBase, scenario, step).catch((error) => fail(`${step.id}: ${error.message}`))
    writeFileSync(keyFile, voicedWith)
    durations[step.id] = probeDuration(file)
  }
  writeJson('durations.json', durations)
  console.log(durations)
}

async function record() {
  const useCase = cases.find((c) => c.id === flags.case) ?? fail(`--case <id> is required; cases: ${cases.map((c) => c.id).join(', ')}`)
  for (const name of Object.values(CONTROL)) rmSync(path.join(dir, name), { force: true })
  mkdirSync(path.join(dir, 'cases'), { recursive: true })
  const ffmpeg = await startCapture(capturePath(useCase.id))
  let exitCode
  ffmpeg.on('exit', (code) => { exitCode = code })
  const t0 = await captureStarted(ffmpeg)
  writeJson(CONTROL.state, { case: useCase.id, t0 })
  console.log(`recording ${useCase.id}`)
  while (!existsSync(path.join(dir, CONTROL.stop))) {
    if (exitCode !== undefined) {
      rmSync(path.join(dir, CONTROL.state), { force: true })
      fail(`ffmpeg exited ${exitCode} during the capture of ${useCase.id}`)
    }
    await sleep(200)
  }
  ffmpeg.stdin.write('q')
  await new Promise((resolve) => (exitCode === undefined ? ffmpeg.on('exit', resolve) : resolve()))
  if (flags.window) await windowClientArea(flags.window, false, innerSizeReader(flags.inner))
  const caseMarks = Object.fromEntries(readMarks().map(({ id, at }) => [id, (at - t0) / 1000]))
  const marks = existsSync(path.join(dir, 'marks.json')) ? readJson('marks.json') : {}
  writeJson('marks.json', { ...marks, [useCase.id]: caseMarks })
  rmSync(path.join(dir, CONTROL.state), { force: true })
  console.log(`recorded ${capturePath(useCase.id)}`)
}

async function mark() {
  const id = positional ?? fail('usage: fv.mjs mark <workdir> <stepId>')
  const state = await captureState()
  const step = cases.find((c) => c.id === state.case).steps.find((s) => s.id === id) ?? fail(`step ${id} is not in case ${state.case}`)
  await holdLastStep(0)
  appendFileSync(path.join(dir, CONTROL.marks), `${JSON.stringify({ id, at: Date.now() })}\n`)
  console.log(`[${((Date.now() - state.t0) / 1000).toFixed(1)}s] ${id}: ${step.say}`)
}

async function stop() {
  const state = await captureState()
  await holdLastStep(1)
  writeFileSync(path.join(dir, CONTROL.stop), '')
  const deadline = Date.now() + 30_000
  while (existsSync(path.join(dir, CONTROL.state))) {
    if (Date.now() > deadline) fail('the recorder did not finish within 30 s')
    await sleep(200)
  }
  console.log(`cases/${state.case}.mkv`)
}

async function captureState() {
  const file = path.join(dir, CONTROL.state)
  const deadline = Date.now() + 30_000
  while (!existsSync(file)) {
    if (Date.now() > deadline) fail('no capture running: start `fv.mjs record <workdir> --case <id>` in the background first')
    await sleep(200)
  }
  return readJson(CONTROL.state)
}

function readMarks() {
  const file = path.join(dir, CONTROL.marks)
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
}

async function holdLastStep(tailSec) {
  const last = readMarks().at(-1)
  if (!last) return
  const durations = readJson('durations.json')
  const { delay = 0 } = steps.find((s) => s.id === last.id)
  const left = last.at / 1000 + delay + durations[last.id] + GAP_SEC + tailSec - Date.now() / 1000
  if (left > 0) await sleep(left * 1000)
}

function viewport() {
  const value = positional ?? fail('usage: fv.mjs viewport <workdir> <innerWidth>x<innerHeight>@<devicePixelRatio> [--check]')
  if (!flags.check) return writeJson('viewport.json', value)
  const rehearsed = existsSync(path.join(dir, 'viewport.json')) ? readJson('viewport.json') : fail('no viewport.json: save the rehearsal viewport first')
  if (value !== rehearsed) fail(`viewport ${value} differs from the rehearsal ${rehearsed}: position targets would miss. Size the window as in the rehearsal (window pin) or rehearse again.`)
}

function optionReader(args) {
  return (...names) => { const i = args.findIndex((a) => names.includes(a)); return i < 0 ? undefined : args[i + 1] }
}
// Joins the case captures in scenario order; `timeline.json` holds each step's start in the joined capture.
function assemble() {
  const durations = readJson('durations.json')
  const marks = readJson('marks.json')
  const missing = cases.filter((c) => !marks[c.id] || !existsSync(capturePath(c.id))).map((c) => c.id)
  if (missing.length) fail(`not recorded: ${missing.join(', ')}. Run record --case <id> for each.`)
  const timeline = {}
  let offset = 0
  for (const { id, steps: caseSteps } of cases) {
    for (const step of caseSteps) timeline[step.id] = offset + marks[id][step.id]
    offset += probeDuration(capturePath(id))
  }
  writeJson('timeline.json', timeline)

  // Cases share a size when recorded with the same flags; one that differs is letterboxed into the first one's frame.
  const [w, h] = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', capturePath(cases[0].id)]).trim().split(',').map(Number)
  const W = Math.min(1920, w - (w % 2))
  const CH = Math.round((h * W) / w / 2) * 2
  const H = CH + belowStrip(CH)

  writeFileSync(path.join(dir, 'title.txt'), scenario.title)
  writeFileSync(path.join(dir, 'subtitle.txt'), scenario.subtitle ?? ' ')
  // A step's narration and its subtitle start `delay` seconds after the step.
  const start = ({ id, delay = 0 }) => timeline[id] + delay
  writeFileSync(path.join(dir, 'subs.srt'), steps.map((step, i) =>
    `${i + 1}\n${srtTime(start(step))} --> ${srtTime(start(step) + durations[step.id])}\n${step.say}\n`).join('\n'))

  const captureInputs = cases.flatMap(({ id }) => ['-i', capturePath(id)])
  const audioInputs = steps.flatMap(({ id }) => ['-i', audioFiles(path.join(dir, 'audio', id))[0] ?? fail(`no audio for ${id}: run narrate`)])
  const fitted = cases.map((_, i) =>
    `[${i + 1}:v]scale=${W}:${CH}:force_original_aspect_ratio=decrease,pad=${W}:${CH}:(ow-iw)/2:(oh-ih)/2:color=0x1e2430,fps=30,setsar=1[c${i}]`)
  const delays = steps.map((step, i) => {
    const ms = Math.round((TITLE_SEC + start(step)) * 1000)
    return `[${i + 1 + cases.length}:a]adelay=${ms}|${ms}[a${i}]`
  })
  const font = platformFont()
  const text = (file, size, y) => `drawtext=fontfile='${font.file}':textfile=${file}:fontsize=${size}:fontcolor=white:x=(w-tw)/2:y=${y}`
  const graph = [
    `[0:v]${text('title.txt', Math.round(H / 16), '(h/2)-th')},${text('subtitle.txt', Math.round(H / 32), '(h/2)+th/2+20')},format=yuv420p[title]`,
    ...fitted,
    `${cases.map((_, i) => `[c${i}]`).join('')}concat=n=${cases.length}:v=1:a=0,pad=${W}:${H}:0:0:color=0x1e2430,${subtitlesFilter(font.family)}format=yuv420p[main]`,
    `[title][main]concat=n=2:v=1:a=0[v]`,
    ...delays,
    `${steps.map((_, i) => `[a${i}]`).join('')}amix=inputs=${steps.length}:normalize=0,apad[a]`,
  ].join(';')
  run(FFMPEG, ['-y', '-f', 'lavfi', '-i', `color=c=0x1e2430:s=${W}x${H}:d=${TITLE_SEC}:r=30`, ...captureInputs, ...audioInputs,
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-shortest',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'video.mp4'])
  console.log(path.join(dir, 'video.mp4'))
}

// `below` puts the subtitles in a strip under the capture, so they never cover the UI; the strip holds two lines.
function belowStrip(captureHeight) {
  const { size = 18, position = 'bottom' } = scenario.subtitles ?? {}
  if (scenario.subtitles === false || position !== 'below') return 0
  return Math.round((captureHeight * size * 3) / 288 / 2) * 2
}

// ASS colours are &HAABBGGRR, alpha 00 opaque; BorderStyle=3 puts a box in OutlineColour behind each line, readable over any UI.
function subtitlesFilter(fontFamily) {
  if (scenario.subtitles === false) return ''
  const { size = 18, color = '#ffffff', position = 'bottom', margin = 24 } = scenario.subtitles ?? {}
  const below = position === 'below'
  const bgr = color.replace(/^#(..)(..)(..)$/, '$3$2$1')
  const style = [`FontName=${fontFamily}`, `FontSize=${size}`, `PrimaryColour=&H00${bgr}`, `BorderStyle=${below ? 1 : 3}`, 'OutlineColour=&H60000000',
    `Outline=${below ? 0 : 4}`, 'Shadow=0', `Alignment=${position === 'top' ? 6 : 2}`, `MarginV=${below ? Math.round(size / 3) : margin}`]  // force_style over SRT takes legacy SSA codes: 6 is top centre, 2 bottom centre
  return `subtitles=subs.srt:force_style='${style.join(',')}',`
}

async function startCapture(out) {
  const region = flags.window ? await windowClientArea(flags.window, true, innerSizeReader(flags.inner)) : flags.region
  const { args, regionCrop } = captureInput(region, flags.cursor === true)
  // yuv420p needs an even width and height: libx264 refuses to open on an odd one.
  return spawn(FFMPEG, ['-y', ...args,
    '-vf', `${regionCrop}crop=trunc(iw/2)*2:trunc(ih/2)*2`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'ignore', 'pipe'] })
}

async function attach() {
  const file = path.resolve(dir, typeof flags.file === 'string' ? flags.file : 'video.mp4')
  if (!existsSync(file)) fail(`no ${file}: run assemble first`)
  const body = [`**${scenario.title}**`, scenario.subtitle].filter(Boolean).join('\n\n')
  console.log(await attachVideo({ file, target: typeof flags.to === 'string' ? flags.to : undefined, body, settings: scenario, isDryRun: flags['dry-run'] === true }))
}

function innerSizeReader(value) {
  const [width, height] = typeof value === 'string' ? value.split('x').map(Number) : []
  return async () => (width > 0 && height > 0 ? [width, height] : undefined)
}

async function windowAction([action, ...args]) {
  const opt = optionReader(args)
  if (action === 'place') return placeWindows({ left: opt('--left'), right: opt('--right'), splitX: opt('--split-x'), waitSec: Number(opt('--wait') ?? 0) })
  if (action === 'pin') {
    return pinWindow({ title: opt('--title') ?? fail('window pin: --title'), width: Number(opt('--width')), height: Number(opt('--height')), secondary: args.includes('--secondary') }, innerSizeReader(opt('--inner')))
  }
  fail(`window: unknown action ${action}; supported: place, pin`)
}

function checkRequirements() {
  const required = [
    [Boolean(findTool('ffmpeg', true)) && Boolean(findTool('ffprobe', true)), 'ffmpeg and ffprobe (winget install Gyan.FFmpeg | brew install ffmpeg | apt install ffmpeg)'],
    [Boolean(edgeTtsCommand()), 'edge-tts (pipx install edge-tts, or pip install edge-tts)'],
    ...platformRequirements(),
  ]
  for (const [isMet, requirement] of required) console.log(`${isMet ? 'ok  ' : 'MISS'} ${requirement}`)
  process.exit(required.every(([isMet]) => isMet) ? 0 : 1)
}


function platformFont() {
  if (process.platform === 'win32') return { file: 'C\\:/Windows/Fonts/segoeui.ttf', family: 'Segoe UI' }
  if (process.platform === 'darwin') {
    const file = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'].find(existsSync)
    return { file: file ?? fail('no Arial or Helvetica font found'), family: 'Arial' }
  }
  const match = spawnSync('fc-match', ['-f', '%{file}\n%{family[0]}', 'sans-serif'], { encoding: 'utf8' })
  const [file, family] = match.status === 0 ? match.stdout.split('\n') : []
  return { file: file?.replace(/:/g, '\\:') ?? fail('fc-match finds no sans-serif font: apt install fontconfig fonts-dejavu-core'), family: family ?? 'DejaVu Sans' }
}

function captureStarted(ffmpeg) {
  return new Promise((resolve, reject) => {
    let log = ''
    ffmpeg.stderr.on('data', function onData(chunk) {
      log += chunk
      // ffmpeg prints frame=0 before an encoder failure too, so wait for a real frame.
      if (/frame=\s*[1-9]/.test(log)) {
        ffmpeg.stderr.off('data', onData)
        ffmpeg.stderr.resume()
        resolve(Date.now())
      }
    })
    ffmpeg.on('exit', (code) => reject(new Error(`ffmpeg exited ${code}:\n${log.slice(-2000)}`)))
  })
}

function findTool(name, isOptional = false) {
  if (spawnSync(name, ['-version']).status === 0) return name
  const winget = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', `${name}.exe`) : undefined
  if (winget && existsSync(winget)) return winget
  return isOptional ? undefined : fail(`${name} not found: winget install Gyan.FFmpeg | brew install ffmpeg | apt install ffmpeg`)
}

function probeDuration(file) {
  return Number(run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim())
}

function run(bin, args) {
  const r = spawnSync(bin, args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) fail(`${bin} failed:\n${(r.stderr || r.error?.message || '').slice(-3000)}`)
  return r.stdout
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000)
  const pad = (n, l = 2) => String(n).padStart(l, '0')
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

function readJson(name) {
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
}

function writeJson(name, data) {
  writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2))
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
