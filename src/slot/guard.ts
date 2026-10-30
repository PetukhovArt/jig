import { connect } from 'node:net'
import { git } from '../core/git'

const CHECKOUT_WINDOW_MS = 2 * 60 * 60 * 1000
const PROBE_TIMEOUT_MS = 400
const PROBE_HOSTS = ['127.0.0.1', '::1']
const REFLOG_LIMIT = '50'

interface Checkout {
  entry: string
  sha: string
}

const recentCheckout = (dir: string, now: number): Checkout | undefined => {
  const log = git(['reflog', 'show', '--date=unix', '--format=%H%x09%gd%x09%gs', '-n', REFLOG_LIMIT, 'HEAD'], dir)
  if (!log.ok) return undefined
  const lines = log.stdout.split(/\r?\n/).filter(Boolean)
  for (const [index, line] of lines.entries()) {
    const [sha, selector, subject] = line.split('\t')
    const seconds = Number(/\{(\d+)\}$/.exec(selector ?? '')?.[1])
    if (sha === undefined || subject === undefined || !subject.startsWith('checkout:') || !Number.isFinite(seconds)) continue
    const age = now - seconds * 1000
    if (age > CHECKOUT_WINDOW_MS) return undefined
    return { entry: `HEAD@{${index}}: ${subject} (${Math.max(0, Math.round(age / 60_000))} min ago)`, sha }
  }
  return undefined
}

const answers = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (open: boolean): void => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })

const listeningPort = async (ports: readonly number[]): Promise<number | undefined> => {
  const probes = await Promise.all(
    ports.map(async (port) => ({ port, open: (await Promise.all(PROBE_HOSTS.map((host) => answers(host, port)))).some(Boolean) })),
  )
  return probes.find((probe) => probe.open)?.port
}

export interface ForeignUseQuery {
  dir: string
  target: string
  ports: readonly number[]
  now?: number
}

export const foreignUseOf = async ({ dir, target, ports, now = Date.now() }: ForeignUseQuery): Promise<string | undefined> => {
  const head = git(['rev-parse', 'HEAD'], dir)
  if (head.ok && head.stdout.trim() === target) return undefined
  const checkout = recentCheckout(dir, now)
  if (checkout !== undefined && checkout.sha !== target) return checkout.entry
  const port = await listeningPort(ports)
  return port === undefined ? undefined : `a process answers on port ${port}`
}
