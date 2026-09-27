<script setup>
// client/display/src/components/ExitKiosk.vue — the exit button: leaves kiosk mode on this screen only
//
// The kiosk script on this device (installers/kiosk/*.sh) collects the request
// (POST /api/device/kiosk-exit) within a few seconds, closes its full-screen browser and opens a
// normal window instead. The server, the other displays and the published slideshows are not
// affected; the screen returns to kiosk mode when it restarts. Its pop-up closes by itself after
// 60 seconds.
//
// Props: visible (while the mouse, keyboard or touchscreen is in use)
// Used by: App.vue (kiosk only)
// Uses: CornerButton, ScreenDialog
import { ref, onUnmounted } from 'vue';
import CornerButton from './CornerButton.vue';
import ScreenDialog from './ScreenDialog.vue';

defineProps({
  visible: Boolean,   // shown while the mouse (or keyboard, or touchscreen) is being used
});

const AUTO_CLOSE_MS = 60 * 1000;
const step = ref('');   // '' | 'confirm' | 'leaving'
const failed = ref(false);
let closeTimer = null;

function open() {
  step.value = 'confirm';
  failed.value = false;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, AUTO_CLOSE_MS);
}

function close() {
  step.value = '';
  clearTimeout(closeTimer);
}

async function leave() {
  step.value = 'leaving';
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, AUTO_CLOSE_MS);
  try {
    const res = await fetch('/api/device/kiosk-exit', { method: 'POST' });
    if (!res.ok) throw new Error();
  } catch {
    failed.value = true;
  }
  // A browser in ordinary full screen (e.g. F11 or a fullscreen request) can leave it itself
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

onUnmounted(() => clearTimeout(closeTimer));
</script>

<template>
  <CornerButton
    v-show="visible || step"
    corner="right"
    :opacity="0.5"
    :hover-opacity="0.9"
    class="exit-button"
    aria-label="Leave full screen on this screen"
    title="Leave full screen on this screen"
    @click="open"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4v5H4v2h7V4H9zm6 0h-2v7h7V9h-5V4zM4 13v2h5v5h2v-7H4zm9 0v7h2v-5h5v-2h-7z" />
    </svg>
  </CornerButton>

  <ScreenDialog v-if="step" class="exit-popup" aria-labelledby="exit-title">
    <template v-if="step === 'confirm'">
      <h2 id="exit-title" class="exit-title">Leave full screen on this screen?</h2>
      <p>This screen's browser becomes a normal window, so you can use it, minimise or close it, or get back to the desktop.</p>
      <p>Nothing else changes: the slideshow keeps running on every other screen, and nothing is unpublished. This screen goes back to full screen the next time it starts up.</p>
      <div class="exit-actions">
        <button type="button" class="exit-cancel" @click="close">Cancel</button>
        <button type="button" class="exit-confirm" @click="leave">Leave full screen</button>
      </div>
    </template>
    <template v-else>
      <h2 id="exit-title" class="exit-title">Leaving full screen…</h2>
      <p v-if="failed">Couldn't reach the Noticeboard server to ask. Try again in a moment.</p>
      <template v-else>
        <p>Within a few seconds, this screen's browser closes and opens again as a normal window.</p>
        <p class="exit-hint">If nothing happens, this browser isn't run by the Noticeboard kiosk: press F11 or Esc to leave full screen, or Alt+F4 to close it.</p>
      </template>
      <div class="exit-actions">
        <button type="button" class="exit-cancel" @click="close">Close</button>
      </div>
    </template>
  </ScreenDialog>
</template>

<style scoped>
/* The button itself: CornerButton (top right, a little less faint than the pin). The pop-up:
   ScreenDialog, with its size and text here */
.exit-popup {
  width: min(560px, 90vw);
  padding: clamp(20px, 3vw, 36px);
  color: #e5e7eb;
  font-size: clamp(15px, 1.6vw, 19px);
  line-height: 1.5;
}
.exit-popup p { margin-bottom: 12px; }
.exit-title {
  font-size: clamp(18px, 2.2vw, 26px);
  font-weight: 600;
  color: #f9fafb;
  margin-bottom: 14px;
}
.exit-hint { color: #9ca3af; }
.exit-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
.exit-actions button {
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: clamp(14px, 1.5vw, 17px);
  cursor: pointer;
}
.exit-cancel { background: #374151; color: #f9fafb; }
.exit-confirm { background: #2563eb; color: #fff; }
</style>
