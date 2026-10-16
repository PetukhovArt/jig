import { describe, expect, it } from 'vitest'
import { createTelemetryConnection, type TelemetrySocket } from './telemetry-connection'

const recordingSockets = () => {
  const log: string[] = []
  let opened = 0
  const open = (): TelemetrySocket => {
    opened += 1
    const id = opened
    log.push(`open#${id}`)
    return {
      send: (message) => log.push(`send#${id}:${message}`),
      close: () => log.push(`close#${id}`),
    }
  }
  return { log, open }
}

describe('telemetry connection', () => {
  it('shares one socket between subscribers and closes it after the last one leaves', () => {
    const sockets = recordingSockets()
    const connection = createTelemetryConnection(sockets.open)
    const first = connection.subscribe()
    const second = connection.subscribe()
    first()
    expect(connection.isOpen()).toBe(true)
    second()
    expect(connection.isOpen()).toBe(false)
    expect(sockets.log).toEqual(['open#1', 'send#1:subscribe:telemetry', 'close#1'])
  })

  it('ignores a repeated unsubscribe of the same subscriber', () => {
    const sockets = recordingSockets()
    const connection = createTelemetryConnection(sockets.open)
    const first = connection.subscribe()
    connection.subscribe()
    first()
    first()
    expect(connection.isOpen()).toBe(true)
  })

  it('opens a fresh socket for a subscriber after a full close', () => {
    const sockets = recordingSockets()
    const connection = createTelemetryConnection(sockets.open)
    connection.subscribe()()
    connection.subscribe()
    expect(sockets.log).toEqual(['open#1', 'send#1:subscribe:telemetry', 'close#1', 'open#2', 'send#2:subscribe:telemetry'])
  })
})
