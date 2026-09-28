<script setup>
// client/admin/src/components/ui/FlashMessage.vue — shows a useFlash() message, green or red
// Props: flash (from useFlash), tag ('span', or 'p' on its own line). Nothing shows without text.
// An error has a ✕ to dismiss it (it otherwise stays until the next message replaces it).
// Used by: the Settings cards (including Delete content and Port), updates/UpdateSchedule, the
//   slideshow and audio show settings cards, the event audio card
defineProps({
  flash: { type: Object, required: true },
  tag: { type: String, default: 'span' },
});
</script>

<template>
  <component :is="tag" v-if="flash.text" :class="flash.tone === 'ok' ? 'success-msg' : 'error-msg'">
    {{ flash.text }}<button
      v-if="flash.tone !== 'ok'"
      type="button"
      class="flash-dismiss"
      aria-label="Dismiss this message"
      title="Dismiss"
      @click="flash.clear()"
    >✕</button>
  </component>
</template>

<style scoped>
.flash-dismiss {
  margin-left: 6px;
  padding: 0 4px;
  border: none;
  background: none;
  color: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}
.flash-dismiss:hover { opacity: 1; }
</style>
