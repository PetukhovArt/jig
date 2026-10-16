export interface Transport {
  close(): void
}

export interface SharedConnection<T extends Transport> {
  subscribe(): () => void
  current(): T | undefined
}

export const createSharedConnection = <T extends Transport>(open: () => T): SharedConnection<T> => {
  let transport: T | undefined
  let subscribers = 0

  const release = (): void => {
    subscribers -= 1
    if (subscribers > 0 || transport === undefined) return
    transport.close()
    transport = undefined
  }

  return {
    subscribe: () => {
      subscribers += 1
      transport ??= open()
      let released = false
      return () => {
        if (released) return
        released = true
        release()
      }
    },
    current: () => transport,
  }
}
