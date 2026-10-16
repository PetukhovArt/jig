<script setup lang="ts">
import { cameras } from './entities/camera/cameras'
</script>

<template>
  <main>
    <h1>Cameras</h1>
    <p data-testid="camera-count">{{ cameras.length }} cameras</p>
  </main>
</template>
