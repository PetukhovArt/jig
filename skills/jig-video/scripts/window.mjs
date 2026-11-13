import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const OS = process.platform
const LINUX_X11_TOOLS = ['wmctrl', 'xwininfo', 'xrandr', 'xprop']

export function platformRequirements() {
  if (OS === 'win32') return [[true, 'capture: gdigrab']]
  if (OS === 'darwin') {
    const hasAccessibility = jxa(`return Application('System Events').uiElementsEnabled()`) === true
    return [
      [hasAccessibility, 'Accessibility permission for this terminal (System Settings → Privacy & Security → Accessibility): window placement'],
      [true, 'Screen Recording permission for this terminal (System Settings → Privacy & Security → Screen Recording): without it the clip is black or ffmpeg fails'],
    ]
  }
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || (!process.env.DISPLAY && Boolean(process.env.WAYLAND_DISPLAY))
  return [
    [!isWayland, 'an X11 session: x11grab cannot capture Wayland, log in to an X11/Xorg session'],
    [Boolean(process.env.DISPLAY), 'DISPLAY is set'],
    ...LINUX_X11_TOOLS.map((bin) => [onPath(bin), `${bin} (apt install wmctrl x11-utils x11-xserver-utils)`]),
  ]
}

export function captureInput(region) {
  const [x, y, w, h] = region ? region.split(',').map(Number) : []
  if (OS === 'win32') {
    const area = region ? ['-offset_x', x, '-offset_y', y, '-video_size', `${w}x${h}`].map(String) : []
    return { args: ['-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '0', ...area, '-i', 'desktop'], regionCrop: '' }
  }
  if (OS === 'darwin') {
    return {
      args: ['-f', 'avfoundation', '-framerate', '30', '-pixel_format', 'uyvy422', '-capture_cursor', '0', '-i', `${macMainScreenDevice()}:none`],
      regionCrop: region ? `crop=${w}:${h}:${x}:${y},` : '',
    }
  }
  const display = process.env.DISPLAY ?? fail('no DISPLAY: recording on Linux needs an X11 session')
  const size = region ? `${w}x${h}` : x11DesktopSize()
  return { args: ['-f', 'x11grab', '-framerate', '30', '-draw_mouse', '0', '-video_size', size, '-i', `${display}+${region ? `${x},${y}` : '0,0'}`], regionCrop: '' }
}

export async function windowClientArea(title, isTopmost, readInnerSize) {
  if (OS === 'win32') return powershell('window-client-area.ps1', ['-Title', title, '-Topmost', isTopmost ? '1' : '0']).trim()
  if (OS === 'darwin') {
    const win = macWindow(title)
    if (isTopmost) macRaise(win)
    const [, innerHeight] = await readInnerSize(title)
    const mainScreen = macScreens()[0]
    const clientTop = win.y + win.h - innerHeight
    return [win.x - mainScreen.x, clientTop - mainScreen.y, win.w, innerHeight].map((v) => Math.round(v * mainScreen.scale)).join(',')
  }
  const win = x11Window(title)
  run('wmctrl', ['-i', '-r', win.id, '-b', `${isTopmost ? 'add' : 'remove'},above`])
  const info = run('xwininfo', ['-id', win.id])
  const field = (name) => Number(new RegExp(`${name}:\\s+(-?\\d+)`).exec(info)?.[1])
  return [field('Absolute upper-left X'), field('Absolute upper-left Y'), field('Width'), field('Height')].join(',')
}

export async function placeWindows({ left, right, splitX, waitSec = 0 }) {
  if (OS === 'win32') {
    return powershell('place-windows.ps1', [...(left ? ['-Left', left] : []), ...(right ? ['-Right', right] : []),
      ...(splitX ? ['-SplitX', String(splitX)] : []), '-WaitSec', String(waitSec)])
  }
  const area = workArea(false)
  const split = Number(splitX) || area.x + Math.round(area.w / 2)
  const placed = []
  for (const [title, x, w] of [[left, area.x, split - area.x], [right, split, area.x + area.w - split]]) {
    if (!title) continue
    const deadline = Date.now() + waitSec * 1000
    let win = findWindow(title)
    while (!win && Date.now() < deadline) {
      await sleep(250)
      win = findWindow(title)
    }
    if (!win) fail(`not found: ${title}`)
    setOuterFrame(win, x, area.y, w, area.h)
    placed.push(`placed '${win.title}' at x=${x} w=${w} h=${area.h}`)
  }
  return placed.join('\n')
}

export async function pinWindow({ title, width, height, secondary }, readInnerSize) {
  if (OS === 'win32') return powershell('pin-window.ps1', ['-Title', title, '-Width', String(width), '-Height', String(height), ...(secondary ? ['-Secondary'] : [])])
  const area = workArea(secondary)
  if (OS === 'darwin') {
    setOuterFrame(macWindow(title), area.x, area.y, width, height)
    const [innerWidth, innerHeight] = await readInnerSize(title)
    const [titleBarW, titleBarH] = [width - innerWidth, height - innerHeight]
    setOuterFrame(macWindow(title), area.x, area.y, width + titleBarW, height + titleBarH)
  } else {
    const win = x11Window(title)
    const [, , frameTop] = x11FrameExtents(win.id)
    setX11ClientFrame(win, area.x, area.y + frameTop, width, height)
  }
  return `pinned '${title}': client ${width}x${height}`
}

function findWindow(title) {
  return OS === 'darwin' ? macWindow(title, true) : x11Window(title, true)
}

function setOuterFrame(win, x, y, w, h) {
  if (OS === 'darwin') {
    return jxa(`${MAC_WINDOW_BY_INDEX}; const w = windowOf(${JSON.stringify(win)}); try { w.attributes.byName('AXMinimized').value = false } catch {}
      w.position = [${x}, ${y}]; w.size = [${w}, ${h}]`)
  }
  const [left, right, top, bottom] = x11FrameExtents(win.id)
  setX11ClientFrame(win, x, y, w - left - right, h - top - bottom)
}

function setX11ClientFrame(win, x, y, w, h) {
  run('wmctrl', ['-i', '-r', win.id, '-b', 'remove,maximized_vert,maximized_horz,fullscreen'])
  run('wmctrl', ['-i', '-r', win.id, '-e', `0,${x},${y},${w},${h}`])
}

function workArea(secondary) {
  if (OS === 'darwin') {
    const screens = macScreens()
    return (secondary ? screens[1] ?? fail('no secondary screen') : screens[0]).work
  }
  const monitorLine = /^\s*\d+:\s+\+?(\*?)\S+\s+(\d+)\/\d+x(\d+)\/\d+\+(\d+)\+(\d+)/
  const monitors = run('xrandr', ['--listmonitors']).split('\n').map((line) => monitorLine.exec(line)).filter(Boolean)
    .map(([, primaryMark, w, h, x, y]) => ({ isPrimary: primaryMark === '*', x: +x, y: +y, w: +w, h: +h }))
  const monitor = secondary ? monitors.find((m) => !m.isPrimary) ?? fail('no secondary screen') : monitors.find((m) => m.isPrimary) ?? monitors[0]
  const desktopWorkArea = /WA:\s+(\d+),(\d+)\s+(\d+)x(\d+)/.exec(run('wmctrl', ['-d']).split('\n').find((l) => / \* /.test(l)) ?? '')
  if (!desktopWorkArea) return monitor
  const [ax, ay, aw, ah] = desktopWorkArea.slice(1).map(Number)
  const x = Math.max(monitor.x, ax)
  const y = Math.max(monitor.y, ay)
  return { x, y, w: Math.min(monitor.x + monitor.w, ax + aw) - x, h: Math.min(monitor.y + monitor.h, ay + ah) - y }
}

function likePattern(pattern) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${source}$`, 'i')
}

function x11Window(title, isOptional = false) {
  const matches = likePattern(title)
  const wmctrlRow = /^(0x[0-9a-f]+)\s+-?\d+\s+-?\d+\s+-?\d+\s+\d+\s+\d+\s+\S+\s(.*)$/i
  const win = run('wmctrl', ['-lG']).split('\n').map((line) => wmctrlRow.exec(line)).filter(Boolean)
    .map(([, id, t]) => ({ id, title: t })).find((w) => matches.test(w.title))
  return win ?? (isOptional ? undefined : fail(`window not found: ${title}`))
}

function x11FrameExtents(id) {
  const extents = /=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/.exec(spawnSync('xprop', ['-id', id, '_NET_FRAME_EXTENTS'], { encoding: 'utf8' }).stdout ?? '')
  return extents ? extents.slice(1).map(Number) : [0, 0, 0, 0]
}

function x11DesktopSize() {
  const current = /current (\d+) x (\d+)/.exec(run('xrandr', ['--current']))
  return current ? `${current[1]}x${current[2]}` : fail('xrandr reports no screen size')
}

const MAC_WINDOW_BY_INDEX = `function windowOf(t) { return Application('System Events').processes.whose({ unixId: t.pid })()[0].windows[t.index] }`

function macWindow(title, isOptional = false) {
  const matches = likePattern(title)
  const windowsTopLeftInPoints = jxa(`const out = []
    for (const p of Application('System Events').processes.whose({ visible: true })()) {
      p.windows().forEach((w, index) => { const [x, y] = w.position(); const [ww, h] = w.size(); out.push({ pid: p.unixId(), index, title: w.name(), x, y, w: ww, h }) })
    }
    return out`)
  const win = windowsTopLeftInPoints.find((w) => matches.test(w.title ?? ''))
  return win ?? (isOptional ? undefined : fail(`window not found: ${title}`))
}

function macRaise(win) {
  jxa(`${MAC_WINDOW_BY_INDEX}; Application('System Events').processes.whose({ unixId: ${win.pid} })()[0].frontmost = true
    windowOf(${JSON.stringify(win)}).actions.byName('AXRaise').perform()`)
}

function macScreens() {
  return jxa(`ObjC.import('AppKit')
    const screens = $.NSScreen.screens, mainH = screens.objectAtIndex(0).frame.size.height, out = []
    const bottomLeftToTopLeft = (r) => ({ x: r.origin.x, y: mainH - r.origin.y - r.size.height, w: r.size.width, h: r.size.height })
    for (let i = 0; i < screens.count; i++) { const s = screens.objectAtIndex(i); out.push({ ...bottomLeftToTopLeft(s.frame), work: bottomLeftToTopLeft(s.visibleFrame), scale: s.backingScaleFactor }) }
    return out`)
}

function macMainScreenDevice() {
  const devices = spawnSync('ffmpeg', ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8' }).stderr ?? ''
  return /\[(\d+)\] Capture screen 0/.exec(devices)?.[1] ?? fail('ffmpeg avfoundation lists no screen: grant this terminal Screen Recording permission')
}

function jxa(source) {
  const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', `JSON.stringify((() => { ${source} })())`], { encoding: 'utf8' })
  if (r.status !== 0) fail(`osascript failed (Accessibility permission for this terminal?):\n${r.stderr}`)
  return r.stdout.trim() ? JSON.parse(r.stdout) : undefined
}

function powershell(script, args) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, script), ...args])
}

function onPath(bin) {
  return spawnSync(OS === 'win32' ? 'where' : 'which', [bin]).status === 0
}

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8' })
  if (r.status !== 0) fail(`${bin} ${args.join(' ')} failed:\n${r.stdout ?? ''}${r.stderr ?? r.error?.message ?? ''}`)
  return r.stdout
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
