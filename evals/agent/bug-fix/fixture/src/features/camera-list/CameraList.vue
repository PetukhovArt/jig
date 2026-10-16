<script setup lang="ts">
import { computed, ref } from 'vue'
import { cameras } from '../../entities/camera/cameras'
import { paginate } from '../../shared/lib/paginate'

const PAGE_SIZE = 5

const page = ref(1)
const current = computed(() => paginate(cameras, page.value, PAGE_SIZE))
</script>

<template>
  <section>
    <ul data-testid="camera-list">
      <li v-for="camera in current.items" :key="camera.id">{{ camera.name }}</li>
    </ul>
    <nav>
      <button data-testid="prev-page" :disabled="current.page === 1" @click="page = current.page - 1">Prev</button>
      <span data-testid="page-label">{{ current.page }} / {{ current.pageCount }}</span>
      <button data-testid="next-page" :disabled="current.page === current.pageCount" @click="page = current.page + 1">
        Next
      </button>
    </nav>
  </section>
</template>
