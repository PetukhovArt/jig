<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchOperators, type Operator } from '../../entities/operator/operators'
import OperatorRow from './OperatorRow.vue'

const operators = ref<Operator[]>([])

onMounted(async () => {
  operators.value = await fetchOperators()
})
</script>

<template>
  <aside class="operators-panel">
    <h2>{{ operators.length }} operators</h2>
    <OperatorRow v-for="operator in operators" :key="operator.id" :operator="operator" />
  </aside>
</template>
