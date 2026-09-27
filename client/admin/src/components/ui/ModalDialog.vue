<script setup>
// client/admin/src/components/ui/ModalDialog.vue — a pop-up over a dimmed page
//
// The dimmed overlay and the white card; the content goes in the slot. Esc and a click outside
// the card emit `close` (the user decides what that means: cancel, or go back a step).
// Props: role ('dialog' or 'alertdialog'), labelledby / describedby (ids in the content),
//        tag ('div', or 'form' so the card itself is the form)
// Attributes and listeners (e.g. @submit on a form, a class) go to the card, not the overlay.
// A user's scoped styles reach the card with :deep(.dialog).
//
// Used by: MacFilterWarning (and the Software updates confirmations)
import { onMounted, onUnmounted } from 'vue';

defineOptions({ inheritAttrs: false });
defineProps({
  role: { type: String, default: 'dialog' },
  labelledby: { type: String, default: undefined },
  describedby: { type: String, default: undefined },
  tag: { type: String, default: 'div' },
});
const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <component
      :is="tag"
      class="dialog"
      :role="role"
      aria-modal="true"
      :aria-labelledby="labelledby"
      :aria-describedby="describedby"
      v-bind="$attrs"
    >
      <slot />
    </component>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 1000; }
.dialog { background: var(--surface); border-radius: 8px; padding: 22px; width: 100%; max-width: 540px; max-height: calc(100vh - 32px); overflow-y: auto; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3); font-size: 13px; }
</style>
