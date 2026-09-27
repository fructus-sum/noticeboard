// client/display/src/composables/usePageWake.js — "the page is back", for unattended screens
//
// A hidden, frozen or sleeping page can miss timers and pause videos. This calls back whenever
// the page may have been away: it became visible, was unfrozen (Page Lifecycle "resume"), was
// shown from the back/forward cache, or got focus. It doesn't rely on what the page reports about
// its own visibility (browsers can get that wrong), so callers must be harmless when nothing
// was missed.
//
// Provides
//   usePageWake(callback, { online = false })  registers on mount, removes on unmount.
//     online: also when the network comes back (the slideshow retries at once)
//
// Used by
//   components/SlideShow.vue (with online), components/VideoSlide.vue (without)
import { onMounted, onUnmounted } from 'vue';

export function usePageWake(callback, { online = false } = {}) {
  const events = [
    [document, 'visibilitychange'],
    [document, 'resume'],   // Page Lifecycle: the page was frozen
    [window, 'pageshow'],
    [window, 'focus'],
    ...(online ? [[window, 'online']] : []),
  ];
  onMounted(() => events.forEach(([target, name]) => target.addEventListener(name, callback)));
  onUnmounted(() => events.forEach(([target, name]) => target.removeEventListener(name, callback)));
}
