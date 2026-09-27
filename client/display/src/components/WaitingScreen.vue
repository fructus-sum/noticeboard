<script setup>
// client/display/src/components/WaitingScreen.vue — what shows while there's nothing to play
//
// While connecting: a pulsing dot. Connected, with a playlist that has no slides: the logo (when
// turned on) and "No slideshow published".
// Props: connected, received (a playlist arrived, with no slides), logo ({ url } or null)
// Used by: App.vue
defineProps({
  connected: Boolean,
  received: Boolean,   // the server has sent a playlist (and it has no slides)
  logo: { type: Object, default: null },   // { url }, or null when the logo is turned off
});
</script>

<template>
  <div class="waiting">
    <span v-if="!connected" class="dot-pulse" />
    <template v-else-if="received">
      <img v-if="logo" :src="logo.url" alt="" class="logo" />
      <p class="message">No slideshow published</p>
    </template>
  </div>
</template>

<style scoped>
.waiting {
  width: 100%;
  height: 100%;
  background: var(--nb-background, #000);
  display: flex;
  flex-direction: column;
  gap: clamp(20px, 4vh, 48px);
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

/* The logo is at most 500 × 500 already; on a small screen it shrinks to fit, but it is
   never enlarged or stretched */
.logo {
  max-width: min(500px, 80vw);
  max-height: 50vh;
  object-fit: contain;
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
