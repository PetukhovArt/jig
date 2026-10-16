export type CameraStatus = 'online' | 'offline' | 'maintenance'

export interface Camera {
  id: string
  name: string
  status: CameraStatus
}

const NAMES = [
  'Lobby',
  'Parking A',
  'Parking B',
  'Gate',
  'Warehouse',
  'Loading dock',
  'Office 1',
  'Office 2',
  'Server room',
  'Roof',
  'Canteen',
  'Back door',
]

const statusAt = (index: number): CameraStatus => {
  if (index === NAMES.length - 1) return 'maintenance'
  return index % 3 === 0 ? 'offline' : 'online'
}

export const cameras: readonly Camera[] = NAMES.map((name, index) => ({
  id: `cam-${index + 1}`,
  name,
  status: statusAt(index),
}))
