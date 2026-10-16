import type { CameraStatus } from '../../entities/camera/cameras'

export type AlertLevel = 'none' | 'warning' | 'critical'

export const alertLevel = (status: CameraStatus): AlertLevel => {
  let level: AlertLevel = 'none'
  switch (status) {
    case 'offline':
      level = 'critical'
      break
    case 'online':
      level = 'none'
      break
  }
  return level
}

export const isCritical = (status: CameraStatus): boolean => {
  if (alertLevel(status) === 'critical') {
    return true
  } else {
    return false
  }
}
