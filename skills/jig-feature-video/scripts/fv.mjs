#!/usr/bin/env node
// Feature video pipeline. Run from the app checkout (its agent-view.config.json, or CDP_PORT, picks the CDP port).
//   narrate <dir>   audio/<stepId>.mp3 + durations.json (Edge TTS, online)
//   rehearse <dir>  drives the app, no capture; writes viewport.json
//   record <dir>    cases/<caseId>.mkv + marks.json, one clip per case
//   assemble <dir>  joins the clips: video.mp4 + timeline.json
//   cdp <verb> ...  one action over raw CDP (click, fill, wait, eval, drag, screenshot): probes when agent-view is missing
// The app is driven through the agent-view CLI; without it, the same verbs go over raw CDP (`cdp` below).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [cmd, dirArg, ...rest] = process.argv.slice(2)
const AGENT_VIEW = process.env.AGENT_VIEW_JS ?? path.join(process.env.APPDATA ?? '', 'npm/node_modules/@petukhovart/agent-view/dist/cli/index.js')
const HAS_AGENT_VIEW = existsSync(AGENT_VIEW)
if (cmd === 'cdp') {
  const output = await cdp(process.argv.slice(3))
  if (output !== undefined) console.log(output)
  process.exit(0)
}
if (!cmd || !dirArg) fail('usage: fv.mjs <narrate|rehearse|record|assemble> <workdir> [--case caseId] [--window "title"] [--region x,y,w,h] [--from stepId]\n       fv.mjs cdp <click|fill|wait|eval|drag|screenshot> [agent-view flags]')
const dir = path.resolve(dirArg)
const flags = {}
for (let i = 0; i < rest.length; i += 2) flags[rest[i].replace(/^--/, '')] = rest[i + 1]

const TITLE_SEC = 3
const GAP_SEC = 0.6
// The free Edge TTS endpoint drops single requests, and after a burst throttles for minutes (NoAudioReceived).
const TTS_RETRY_PAUSES_SEC = [3, 90, 90]
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const FONT = 'C\\:/Windows/Fonts/segoeui.ttf'
const FFMPEG = findTool('ffmpeg')
const FFPROBE = findTool('ffprobe')

const scenario = readJson('scenario.json')
// Each use case is recorded into its own clip, so a failed case is re-recorded alone; assemble joins them.
const cases = scenario.cases ?? fail('scenario.json: no "cases". Steps live in cases: "cases": [{ "id": "…", "setup": […], "steps": […] }]')
const steps = cases.flatMap((c) => c.steps)
const duplicate = steps.find((s, i) => steps.findIndex((t) => t.id === s.id) !== i)
if (duplicate) fail(`scenario.json: step id ${duplicate.id} is used twice`)
const capturePath = (caseId) => path.join(dir, 'cases', `${caseId}.mkv`)
const commands = { narrate, rehearse: () => drive(false), record: () => drive(true), assemble }
await (commands[cmd] ?? (() => fail(`unknown command ${cmd}`)))()

async function narrate() {
  mkdirSync(path.join(dir, 'audio'), { recursive: true })
  const durations = {}
  for (const step of steps) {
    const { id, say } = step
    const out = path.join(dir, 'audio', `${id}.mp3`)
    // A step's rate, pitch or volume overrides the scenario's.
    const voice = (key, neutral) => ['--' + key, step[key] ?? scenario[key] ?? neutral]
    const args = ['-m', 'edge_tts', '--voice', scenario.voice ?? fail('scenario.json: set "voice"'),
      ...voice('rate', '+0%'), ...voice('pitch', '+0Hz'), ...voice('volume', '+0%'), '--text', say, '--write-media', out]
    let isSynthesised = false
    for (const pause of TTS_RETRY_PAUSES_SEC) {
      isSynthesised = spawnSync('python', args, { cwd: dir }).status === 0
      if (isSynthesised) break
      console.log(`edge-tts failed on ${id}, retrying in ${pause}s`)
      await sleep(pause * 1000)
    }
    if (!isSynthesised) run('python', args)
    durations[id] = probeDuration(out)
  }
  writeJson('durations.json', durations)
  console.log(durations)
}

// rehearse: run the actions without capture or narration pauses; record: capture the screen and hold each step for its narration.
// Every case starts from `setup` + its own `setup` and gets its own capture; `--case` runs one case.
async function drive(capture) {
  const durations = capture ? readJson('durations.json') : {}
  const fromCase = !capture && flags.from ? cases.find((c) => c.steps.some((s) => s.id === flags.from)) ?? fail(`no step ${flags.from}`) : null
  const selected = flags.case ? [cases.find((c) => c.id === flags.case) ?? fail(`no case ${flags.case}; cases: ${cases.map((c) => c.id).join(', ')}`)]
    : fromCase ? cases.slice(cases.indexOf(fromCase)) : cases
  const marks = capture && existsSync(path.join(dir, 'marks.json')) ? readJson('marks.json') : {}
  const stopFocus = await emulateFocus()
  for (const useCase of selected) {
    const from = useCase === fromCase ? useCase.steps.findIndex((s) => s.id === flags.from) : 0
    console.log(`case ${useCase.id}`)
    if (from === 0) for (const action of [...scenario.setup ?? [], ...useCase.setup ?? []]) await act(action)
    await checkViewport(capture)
    if (capture) mkdirSync(path.join(dir, 'cases'), { recursive: true })
    const ffmpeg = capture ? startCapture(capturePath(useCase.id)) : null
    const t0 = capture ? await captureStarted(ffmpeg) : Date.now()
    const now = () => (Date.now() - t0) / 1000
    const caseMarks = {}
    try {
      for (const { id, do: actions = [], delay = 0 } of useCase.steps.slice(from)) {
        caseMarks[id] = now()
        console.log(`[${caseMarks[id].toFixed(1)}s] ${id}`)
        for (const action of actions) await act(action)
        const left = capture ? caseMarks[id] + delay + durations[id] + GAP_SEC - now() : 0
        if (left > 0) await sleep(left * 1000)
      }
      if (capture) await sleep(1000)
    } finally {
      if (ffmpeg) {
        ffmpeg.stdin.write('q')
        await new Promise((r) => ffmpeg.on('exit', r))
        if (flags.window) windowClientArea(flags.window, false)
      }
    }
    for (const action of scenario.teardown ?? []) await act(action)
    // Written per case, so a run that fails later keeps the cases already recorded.
    if (capture) {
      marks[useCase.id] = caseMarks
      writeJson('marks.json', marks)
    }
  }
  stopFocus()
}

// A window that is not the foreground one has no :focus and fires blur, so menus close and fields commit mid-step.
// Focus emulation on every page, held for the whole run, lets the user keep working in another window meanwhile.
async function emulateFocus() {
  const port = cdpPort()
  const sockets = new Map()
  const attach = async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const fresh = targets.filter((t) => t.type === 'page' && !sockets.has(t.id))
    await Promise.all(fresh.map((t) => new Promise((resolve) => {
      const ws = new WebSocket(t.webSocketDebuggerUrl)
      ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } })); resolve() }
      ws.onclose = () => { sockets.delete(t.id); resolve() }
      sockets.set(t.id, ws)
    })))
  }
  await attach()
  // Pop-out windows open mid-run.
  const timer = setInterval(() => attach().catch(() => {}), 1000)
  return () => { clearInterval(timer); for (const ws of sockets.values()) ws.close() }
}

// `--pos` coordinates are CSS pixels of the window size rehearse ran at; record fails before capture when that size changed.
async function checkViewport(capture) {
  const viewport = JSON.parse(await agentView(['eval', '--json', "innerWidth + 'x' + innerHeight + '@' + devicePixelRatio"]))
  if (!capture) return writeJson('viewport.json', viewport)
  const rehearsed = existsSync(path.join(dir, 'viewport.json')) ? readJson('viewport.json') : fail('no viewport.json: run rehearse first')
  if (viewport !== rehearsed) fail(`viewport ${viewport} differs from rehearse ${rehearsed}: --pos targets would miss. Size the window as in rehearse (pin-window.ps1) or rehearse again.`)
}

async function act([verb, ...args]) {
  if (verb === 'sleep') return sleep(Number(args[0]))
  // An OS-level action agent-view cannot do, e.g. placing a window; a failure fails the run like a failed click.
  if (verb === 'run') {
    const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8' })
    return r.status === 0 ? undefined : fail(`run ${args[0]} failed:\n${r.stdout}\n${r.stderr}`)
  }
  if (verb === 'click' || verb === 'drag') await glideCursor(args)
  await agentView([verb, ...args])
}

// Shows a cursor dot in the page and glides it to the click target or the drag start: CDP input moves no real cursor, so the capture would show none.
// During a `--pointer` drag the dot follows the dispatched mousemove events.
async function glideCursor(args) {
  const opt = optionReader(args)
  const target = { ...targetOf(opt), pos: opt('--pos', '-p') ?? opt('--from-pos') }
  const window = opt('--window', '-w')
  const script = `(async (t) => {
    let dot = document.getElementById('fv-cursor')
    if (!dot) {
      dot = Object.assign(document.createElement('div'), { id: 'fv-cursor' })
      dot.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,200,0,.6);border:2px solid #fff;box-shadow:0 0 6px #000;left:50vw;top:50vh;transition:left .5s ease-in-out,top .5s ease-in-out'
      document.documentElement.append(dot)
      addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
    }
    const el = (${findElementSource()})(t)
    const r = el?.getBoundingClientRect()
    const [x, y] = r ? [r.x + r.width / 2, r.y + r.height / 2] : (t.pos ?? '').split(',').map(Number)
    if (Number.isNaN(x) || x === undefined) return
    dot.style.left = x + 'px'; dot.style.top = y + 'px'
    await new Promise((res) => setTimeout(res, 650))
  })(${JSON.stringify(target)})`
  await agentView(['eval', '--await', ...(window ? ['--window', window] : []), script])
}

async function agentView(args) {
  if (!HAS_AGENT_VIEW) return cdp(args)
  const r = spawnSync(process.execPath, [AGENT_VIEW, ...args], { encoding: 'utf8' })
  if (r.status !== 0) fail(`agent-view ${args.slice(0, 3).join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

// Page-side lookup shared by the cursor dot and the CDP fallback: test id, CSS selector, or visible text (exact match first).
// A function, not a const: the `cdp` command runs before the module's consts are initialised.
function findElementSource() {
  return `(t) => {
    const visible = (el) => el.getClientRects().length > 0
    const byText = (text) => [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.textContent.trim() === text).pop()
      ?? [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.textContent.includes(text)).pop()
    return (t.testid ? document.querySelector('[data-testid="' + t.testid + '"]') : t.selector ? document.querySelector(t.selector) : t.filter ? byText(t.filter) : null) ?? null
  }`
}

function optionReader(args) {
  return (...names) => { const i = args.findIndex((a) => names.includes(a)); return i < 0 ? undefined : args[i + 1] }
}

function targetOf(opt) {
  return { testid: opt('--testid'), selector: opt('--selector'), filter: opt('--filter', '-f') }
}

// The agent-view verbs a scenario uses, over raw CDP, for a machine without agent-view. Covers click (--testid, --selector,
// -f, --pos, --right, --double), fill, wait (-t), eval (--await, --json), drag (--from-pos/--to-pos, pointer events only),
// screenshot [file]; --window matches a title substring or a target id. Refs from `dom`, --scene, --modifiers and HTML5 drag need agent-view.
async function cdp([verb, ...args]) {
  const opt = optionReader(args)
  const has = (name) => args.includes(name)
  const VALUE_FLAGS = ['--testid', '--selector', '--filter', '-f', '--pos', '-p', '--window', '-w', '--timeout', '-t',
    '--from-pos', '--to-pos', '--steps', '--button', '--hold-ms']
  const positional = args.filter((a, i) => !a.startsWith('-') && !VALUE_FLAGS.includes(args[i - 1]))
  const unsupported = ['--scene', '--modifiers', '--from', '--to', '--html5', '--cancel', '--mask'].filter(has)
  if (unsupported.length || (verb === 'click' && positional.length)) {
    fail(`cdp ${verb}: ${unsupported.join(', ') || 'a dom ref'} needs agent-view. Without it: --testid, --selector, -f, --pos.`)
  }
  const page = await openPage(opt('--window', '-w'))
  const evaluate = async (expression, awaitPromise = false) => {
    const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (exceptionDetails) fail(`cdp ${verb}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
    return result.value
  }
  const target = targetOf(opt)
  const find = `(${findElementSource()})(${JSON.stringify(target)})`
  const describe = () => JSON.stringify(Object.fromEntries(Object.entries(target).filter(([, v]) => v)))
  const centre = async () => {
    const pos = opt('--pos', '-p')
    if (pos) return pos.split(',').map(Number)
    return await evaluate(`(() => { const el = ${find}; if (!el) return null
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
      ?? fail(`cdp ${verb}: no element ${describe()} in "${page.title}"`)
  }
  const mouse = (type, [x, y], button = 'left', clickCount = 1) =>
    page.send('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseReleased' || button === 'none' ? 0 : { left: 1, right: 2, middle: 4 }[button], clickCount })
  try {
    if (verb === 'click') {
      const at = await centre()
      const button = has('--right') ? 'right' : 'left'
      await mouse('mouseMoved', at, 'none')
      for (const count of has('--double') ? [1, 2] : [1]) {
        await mouse('mousePressed', at, button, count)
        await mouse('mouseReleased', at, button, count)
      }
    } else if (verb === 'fill') {
      const value = positional.at(-1) ?? fail('cdp fill: no value')
      // A test id or label may name a wrapper: the field is the element itself or the first one inside it.
      const isFocused = await evaluate(`(() => { const el = ${find}
        const field = el?.matches('input, textarea, [contenteditable]') ? el : el?.querySelector('input, textarea, [contenteditable]')
        if (!field) return false
        field.focus(); field.select ? field.select() : document.execCommand('selectAll'); return true })()`)
      if (!isFocused) fail(`cdp fill: no field at ${describe()} in "${page.title}"`)
      await page.send('Input.insertText', { text: value })
    } else if (verb === 'wait') {
      const deadline = Date.now() + Number(opt('--timeout', '-t') ?? 10) * 1000
      while (!(await evaluate(`!!${find}`))) {
        if (Date.now() > deadline) fail(`cdp wait: ${describe()} did not appear in "${page.title}" within ${opt('--timeout', '-t') ?? 10}s`)
        await sleep(200)
      }
    } else if (verb === 'eval') {
      const value = await evaluate(positional.at(-1) ?? fail('cdp eval: no expression'), has('--await'))
      return has('--json') ? JSON.stringify(value) : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } else if (verb === 'drag') {
      const from = (opt('--from-pos') ?? fail('cdp drag: needs --from-pos and --to-pos')).split(',').map(Number)
      const to = (opt('--to-pos') ?? fail('cdp drag: needs --to-pos')).split(',').map(Number)
      const button = opt('--button') ?? 'left'
      const steps = Number(opt('--steps') ?? 10)
      await mouse('mouseMoved', from, 'none')
      await mouse('mousePressed', from, button)
      await sleep(Number(opt('--hold-ms') ?? 0))
      for (let i = 1; i <= steps; i++) await mouse('mouseMoved', from.map((v, k) => v + ((to[k] - v) * i) / steps), button)
      await mouse('mouseReleased', to, button)
    } else if (verb === 'screenshot') {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
      const file = path.resolve(positional[0] ?? 'screenshot.png')
      writeFileSync(file, Buffer.from(data, 'base64'))
      return file
    } else {
      fail(`cdp: unknown verb ${verb}; supported: click, fill, wait, eval, drag, screenshot`)
    }
  } finally {
    page.close()
  }
}

async function openPage(window) {
  const pages = (await (await fetch(`http://127.0.0.1:${cdpPort()}/json/list`)).json()).filter((t) => t.type === 'page')
  const target = window ? pages.find((p) => p.id === window || p.title.includes(window)) : pages[0]
  if (!target) fail(`no window "${window ?? ''}"; open: ${pages.map((p) => `"${p.title}"`).join(', ') || 'none'}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`cannot connect to "${target.title}"`)) })
  const pending = new Map()
  let seq = 0
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++seq, { resolve, reject })
    ws.send(JSON.stringify({ id: seq, method, params }))
  })
  return { send, title: target.title, close: () => ws.close() }
}

function cdpPort() {
  if (process.env.CDP_PORT) return process.env.CDP_PORT
  if (existsSync('agent-view.config.json')) return JSON.parse(readFileSync('agent-view.config.json', 'utf8')).port
  fail('no CDP port: run from a checkout with agent-view.config.json, or set CDP_PORT')
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
  const audioInputs = steps.flatMap(({ id }) => ['-i', `audio/${id}.mp3`])
  const fitted = cases.map((_, i) =>
    `[${i + 1}:v]scale=${W}:${CH}:force_original_aspect_ratio=decrease,pad=${W}:${CH}:(ow-iw)/2:(oh-ih)/2:color=0x1e2430,fps=30,setsar=1[c${i}]`)
  const delays = steps.map((step, i) => {
    const ms = Math.round((TITLE_SEC + start(step)) * 1000)
    return `[${i + 1 + cases.length}:a]adelay=${ms}|${ms}[a${i}]`
  })
  const text = (file, size, y) => `drawtext=fontfile='${FONT}':textfile=${file}:fontsize=${size}:fontcolor=white:x=(w-tw)/2:y=${y}`
  const graph = [
    `[0:v]${text('title.txt', Math.round(H / 16), '(h/2)-th')},${text('subtitle.txt', Math.round(H / 32), '(h/2)+th/2+20')},format=yuv420p[title]`,
    ...fitted,
    `${cases.map((_, i) => `[c${i}]`).join('')}concat=n=${cases.length}:v=1:a=0,pad=${W}:${H}:0:0:color=0x1e2430,${subtitlesFilter()}format=yuv420p[main]`,
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
function subtitlesFilter() {
  if (scenario.subtitles === false) return ''
  const { size = 18, color = '#ffffff', position = 'bottom', margin = 24 } = scenario.subtitles ?? {}
  const below = position === 'below'
  const bgr = color.replace(/^#(..)(..)(..)$/, '$3$2$1')
  const style = ['FontName=Segoe UI', `FontSize=${size}`, `PrimaryColour=&H00${bgr}`, `BorderStyle=${below ? 1 : 3}`, 'OutlineColour=&H60000000',
    `Outline=${below ? 0 : 4}`, 'Shadow=0', `Alignment=${position === 'top' ? 6 : 2}`, `MarginV=${below ? Math.round(size / 3) : margin}`]  // force_style over SRT takes legacy SSA codes: 6 is top centre, 2 bottom centre
  return `subtitles=subs.srt:force_style='${style.join(',')}',`
}

function startCapture(out) {
  const region = flags.window ? windowClientArea(flags.window, true) : flags.region
  const area = region ? (([x, y, rw, rh]) => ['-offset_x', x, '-offset_y', y, '-video_size', `${rw}x${rh}`])(region.split(',')) : []
  // yuv420p needs an even width and height: libx264 refuses to open on an odd one.
  return spawn(FFMPEG, ['-y', '-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '0', ...area, '-i', 'desktop',
    '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'ignore', 'pipe'] })
}

function windowClientArea(title, isTopmost) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, 'window-client-area.ps1'), '-Title', title, '-Topmost', isTopmost ? '1' : '0']).trim()
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

function findTool(name) {
  const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', `${name}.exe`)
  return spawnSync(name, ['-version']).status === 0 ? name : existsSync(winget) ? winget : fail(`${name} not found`)
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
