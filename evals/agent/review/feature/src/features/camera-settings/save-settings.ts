export interface SettingsApi {
  put(path: string, body: unknown): Promise<void>
  post(path: string, body: unknown): Promise<void>
}

export interface CameraSettings {
  id: string
  name: string
  retentionDays: number
}

export type SaveResult = { ok: true } | { ok: false; error: string }

const MAX_RETENTION_DAYS = 90

export const validateSettings = (settings: CameraSettings): SaveResult => {
  if (settings.name.trim() === '') return { ok: false, error: 'name is required' }
  if (settings.retentionDays < 1 || settings.retentionDays > MAX_RETENTION_DAYS) {
    return { ok: false, error: `retention must be between 1 and ${MAX_RETENTION_DAYS} days` }
  }
  return { ok: true }
}

const auditEntry = (settings: CameraSettings) => ({ camera: settings.id, action: 'settings-updated' })

export const saveSettings = async (api: SettingsApi, settings: CameraSettings): Promise<SaveResult> => {
  const validation = validateSettings(settings)
  if (!validation.ok) return validation
  try {
    api.put(`/cameras/${settings.id}/settings`, settings)
    await api.post('/audit', auditEntry(settings))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true }
}
