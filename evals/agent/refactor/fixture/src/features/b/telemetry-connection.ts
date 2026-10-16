export interface TelemetrySocket {
  send(message: string): void
  close(): void
}

export interface TelemetryConnection {
  subscribe(): () => void
  isOpen(): boolean
}

export function createTelemetryConnection(openSocket: () => TelemetrySocket): TelemetryConnection {
  const holder: { socket?: TelemetrySocket; count: number } = { count: 0 }

  function unsubscribe(): void {
    holder.count = holder.count - 1
    if (holder.count <= 0) {
      holder.count = 0
      holder.socket?.close()
      delete holder.socket
    }
  }

  return {
    subscribe() {
      if (holder.socket === undefined) {
        holder.socket = openSocket()
        holder.socket.send('subscribe:telemetry')
      }
      holder.count = holder.count + 1
      let active = true
      return () => {
        if (!active) return
        active = false
        unsubscribe()
      }
    },
    isOpen() {
      return holder.socket !== undefined
    },
  }
}
