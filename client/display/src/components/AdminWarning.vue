<script setup>
// client/display/src/components/AdminWarning.vue — the warning mark while the admin panel needs someone
//
// A small red triangle in the bottom-right corner, always visible while the admin panel shows a
// warning the screens point to: "Run the installer again on the Server", or (with manual updates) a new
// version waiting. It stays out of the way of the slides and the other controls. Clicking or tapping it shows only "Please check the Admin panel for details.":
// the details stay in the admin panel. The message closes with ✕, Esc, or by itself after 60 s.
//
// Used by: App.vue (while display:settings says installerNeeded or updateAvailable)
// Uses: ScreenDialog
import { ref, onMounted, onUnmounted } from 'vue';
import ScreenDialog from './ScreenDialog.vue';

const AUTO_CLOSE_MS = 60 * 1000;

const open = ref(false);
let closeTimer = null;

function show() {
  open.value = true;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, AUTO_CLOSE_MS);
}
function close() {
  open.value = false;
  clearTimeout(closeTimer);
  closeTimer = null;
}
function toggle() {
  if (open.value) close();
  else show();
}
function onKeydown(e) {
  if (e.key === 'Escape' && open.value) close();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(closeTimer);
});
</script>

<template>
  <button
    type="button"
    class="installer-warning"
    aria-label="Warning: please check the Admin panel for details"
    title="Please check the Admin panel for details"
    @click="toggle"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 1 21.5h22L12 2.5z" fill="#dc2626" />
      <path d="M11 9h2v6.5h-2zM11 17h2v2h-2z" fill="#fff" />
    </svg>
  </button>

  <ScreenDialog v-if="open" class="installer-popup" aria-label="Warning">
    <button type="button" class="installer-close" aria-label="Close" @click="close">×</button>
    <p class="installer-message">Please check the Admin panel for details.</p>
  </ScreenDialog>
</template>

<style scoped>
/* A 20 px triangle with some room around it, so it's easy to tap */
.installer-warning {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 1000;
  width: 32px;
  height: 32px;
  padding: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
}
.installer-warning svg { display: block; width: 20px; height: 20px; }
.installer-warning:focus-visible { outline: 2px solid #fff; outline-offset: 2px; border-radius: 4px; }

.installer-popup {
  max-width: 90vw;
  padding: clamp(20px, 3vw, 36px) clamp(24px, 4vw, 48px);
  padding-right: 56px;
  color: #f9fafb;
}
.installer-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  color: #d1d5db;
  font-size: 32px;
  line-height: 1;
  cursor: pointer;
}
.installer-close:hover { color: #fff; }
.installer-message { font-size: clamp(16px, 2vw, 24px); }
</style>
