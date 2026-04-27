<script setup>
defineProps({ connected: Boolean });
</script>

<template>
  <div class="waiting">
    <span v-if="!connected" class="dot-pulse" />
  </div>
</template>

<style scoped>
.waiting {
  width: 100%;
  height: 100%;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Subtle pulsing dot — visible enough to confirm the display is alive */
.dot-pulse {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #222;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.2; }
  50%       { opacity: 0.6; }
}
</style>
