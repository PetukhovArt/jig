<template>
  <a href="https://example.com">a // b</a>
</template>
<script setup lang="ts">
const label = '// not a comment'
</script>
<style scoped>
a { background: url(//cdn.example.com/a.png); }
</style>
