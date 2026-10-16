<script setup lang="ts">
import { cameras } from '../../entities/camera/cameras'
import { createCameraListStore, type SortOrder } from './model/camera-list-store'

const store = createCameraListStore(cameras)

const onQuery = (event: Event): void => {
  store.setQuery((event.target as HTMLInputElement).value)
}

const onSort = (event: Event): void => {
  store.setSort((event.target as HTMLSelectElement).value as SortOrder)
}
</script>

<template>
  <section>
    <div class="toolbar">
      <input data-testid="camera-search" type="search" placeholder="Search" :value="store.state.query" @input="onQuery" />
      <select data-testid="camera-sort" :value="store.state.sort" @change="onSort">
        <option value="name-asc">Name A-Z</option>
        <option value="name-desc">Name Z-A</option>
      </select>
    </div>
    <ul data-testid="camera-list">
      <li v-for="camera in store.visible.value" :key="camera.id" :data-status="camera.status">
        {{ camera.name }} ({{ camera.status }})
      </li>
    </ul>
  </section>
</template>
