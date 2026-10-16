import { computed, reactive } from 'vue'
import type { Camera } from '../../../entities/camera/cameras'
import { persisted } from '../../../shared/lib/storage'

export type SortOrder = 'name-asc' | 'name-desc'

const SORT_ORDERS: readonly SortOrder[] = ['name-asc', 'name-desc']

const isSortOrder = (value: unknown): value is SortOrder => SORT_ORDERS.some((order) => order === value)

const sortStorage = persisted<SortOrder>('camera-list.sort', 'name-asc', isSortOrder)

const matchesQuery = (camera: Camera, query: string): boolean =>
  camera.name.toLowerCase().includes(query.trim().toLowerCase())

const compareNames = (order: SortOrder) => (left: Camera, right: Camera): number =>
  order === 'name-asc' ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name)

export const createCameraListStore = (source: readonly Camera[]) => {
  const state = reactive({ query: '', sort: sortStorage.read() })

  const visible = computed(() =>
    source.filter((camera) => matchesQuery(camera, state.query)).sort(compareNames(state.sort)),
  )

  const setQuery = (query: string): void => {
    state.query = query
  }

  const setSort = (sort: SortOrder): void => {
    state.sort = sort
    sortStorage.write(sort)
  }

  return { state, visible, setQuery, setSort }
}

export type CameraListStore = ReturnType<typeof createCameraListStore>
