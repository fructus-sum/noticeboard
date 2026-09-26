<script setup>
defineProps({
  connected: Boolean,
  received: Boolean,   // the server has sent a playlist (and it has no slides)
});
</script>

<template>
  <div class="waiting">
    <span v-if="!connected" class="dot-pulse" />
    <p v-else-if="received" class="message">No slideshow published</p>
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

/* Readable across a room without shouting on a public screen */
.message {
  color: #9ca3af;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: clamp(20px, 3vw, 40px);
  letter-spacing: 0.02em;
  text-align: center;
  padding: 0 24px;
}
</style>
