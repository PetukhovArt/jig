<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <span class="app-cell" :title="text">{{ text }}</span>
</template>

<style scoped>
.app-cell {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
