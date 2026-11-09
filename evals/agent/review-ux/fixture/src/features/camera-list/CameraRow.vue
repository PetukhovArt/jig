<script setup lang="ts">
import type { Camera } from '../../entities/camera/cameras'
import AppCell from '../../shared/ui/AppCell.vue'

defineProps<{ camera: Camera }>()
</script>

<template>
  <div class="camera-row">
    <AppCell :text="camera.name" />
    <span class="status">{{ camera.status }}</span>
  </div>
</template>

<style scoped>
.camera-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.status {
  flex-shrink: 0;
}
</style>
