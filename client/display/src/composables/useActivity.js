// client/display/src/composables/useActivity.js — whether someone is using the mouse, keyboard or touchscreen
//
// Provides
//   useActivity() → { active }: true while someone is, false after 3 s of stillness. The controls
//   show while it's true, and the cursor hides when it isn't.
//
// Used by: App.vue
import { ref, onMounted, onUnmounted } from 'vue';

// Whether someone is using the mouse, keyboard or touchscreen right now. Controls show while
// they are, and the cursor hides after a few seconds of stillness.
const IDLE_MS = 3000;

export function useActivity() {
  const active = ref(false);
  let timer = null;
  let lastX = null;
  let lastY = null;

  function wake() {
    active.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => { active.value = false; }, IDLE_MS);
  }

  // Browsers can report a "move" when the page changes under a still mouse (e.g. a new
  // slide): only a real change of position counts
  function onMouseMove(e) {
    if (e.screenX === lastX && e.screenY === lastY) return;
    lastX = e.screenX;
    lastY = e.screenY;
    wake();
  }

  const OTHER_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel'];

  onMounted(() => {
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    OTHER_EVENTS.forEach((name) => window.addEventListener(name, wake, { passive: true }));
  });
  onUnmounted(() => {
    clearTimeout(timer);
    window.removeEventListener('mousemove', onMouseMove);
    OTHER_EVENTS.forEach((name) => window.removeEventListener(name, wake));
  });

  return { active };
}
