import { beforeEach, describe, expect, it } from 'vitest'
import type { Camera } from '../../../entities/camera/cameras'
import { memoryBackend, useStorageBackend } from '../../../shared/lib/storage'
import { createCameraListStore } from './camera-list-store'

const cameras: Camera[] = [
  { id: 'c1', name: 'Gate', status: 'online' },
  { id: 'c2', name: 'Lobby', status: 'offline' },
  { id: 'c3', name: 'Parking', status: 'online' },
]

const names = (store: ReturnType<typeof createCameraListStore>): string[] => store.visible.value.map((camera) => camera.name)

describe('camera list store', () => {
  beforeEach(() => {
    useStorageBackend(memoryBackend())
  })

  it('filters cameras by a case-insensitive query', () => {
    const store = createCameraListStore(cameras)
    store.setQuery('  LOB ')
    expect(names(store)).toEqual(['Lobby'])
  })

  it('restores the sort order after a reload', () => {
    createCameraListStore(cameras).setSort('name-desc')
    const reloaded = createCameraListStore(cameras)
    expect(names(reloaded)).toEqual(['Parking', 'Lobby', 'Gate'])
  })
})
