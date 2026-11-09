<script setup lang="ts">
import AppCell from '../../shared/ui/AppCell.vue'

defineProps<{ zone: string; count: number }>()
</script>

<template>
  <div class="zone-row">
    <AppCell :text="zone" />
    <span class="count">{{ count }}</span>
  </div>
</template>

<style scoped>
.zone-row {
  display: flex;
  gap: 8px;
}
.count {
  flex-shrink: 0;
}
</style>
