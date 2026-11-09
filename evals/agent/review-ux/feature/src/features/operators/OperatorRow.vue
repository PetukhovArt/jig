<script setup lang="ts">
import type { Operator } from '../../entities/operator/operators'
import AppCell from '../../shared/ui/AppCell.vue'

defineProps<{ operator: Operator }>()
defineEmits<{ menu: [id: string] }>()
</script>

<template>
  <div class="operator-row">
    <AppCell :text="operator.name" />
    <span class="email">{{ operator.email }}</span>
    <button class="menu" type="button" aria-label="Operator actions" @click="$emit('menu', operator.id)">•••</button>
  </div>
</template>

<style scoped>
.operator-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 280px;
}
.email {
  color: #667085;
}
</style>
