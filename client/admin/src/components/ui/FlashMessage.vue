<script setup>
// client/admin/src/components/ui/FlashMessage.vue — shows a useFlash() message, green or red
// Props: flash (from useFlash), tag ('span', or 'p' on its own line). Nothing shows without text.
// Used by: the Settings cards, the slideshow settings card
defineProps({
  flash: { type: Object, required: true },
  tag: { type: String, default: 'span' },
});
</script>

<template>
  <component :is="tag" v-if="flash.text" :class="flash.tone === 'ok' ? 'success-msg' : 'error-msg'">{{ flash.text }}</component>
</template>
