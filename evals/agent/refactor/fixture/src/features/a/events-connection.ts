export interface EventsSocket {
  send(message: string): void
  close(): void
}

export interface EventsConnection {
  subscribe(): () => void
  isOpen(): boolean
}

export const createEventsConnection = (openSocket: () => EventsSocket): EventsConnection => {
  let socket: EventsSocket | null = null
  let listeners = 0

  return {
    subscribe() {
      listeners++
      if (listeners === 1) {
        socket = openSocket()
        socket.send('subscribe:events')
      }
      let done = false
      return () => {
        if (done) return
        done = true
        listeners--
        if (listeners === 0 && socket !== null) {
          socket.close()
          socket = null
        }
      }
    },
    isOpen() {
      return socket !== null
    },
  }
}
