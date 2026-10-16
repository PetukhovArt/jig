export type CameraStatus = 'online' | 'offline'

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

export const cameras: readonly Camera[] = NAMES.map((name, index) => ({
  id: `cam-${index + 1}`,
  name,
  status: index % 3 === 0 ? 'offline' : 'online',
}))
