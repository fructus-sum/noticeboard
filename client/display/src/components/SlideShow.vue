<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import SlideFrame from './SlideFrame.vue';
import { createSlideshowClock } from '../slideshowClock.js';
import { recoverByReloading } from '../recovery.js';

const props = defineProps({
  slides: { type: Array, required: true },
  connected: { type: Boolean, default: true },
});

// Slides on screen, oldest first: each new slide fades in on top of the previous one, which
// a timer then removes. This deliberately avoids Vue's <Transition>: its leave step waits for
// animation frames, which a hidden page or a switched-off screen doesn't produce, and that
// could hold back every following slide.
const FADE_MS = 400;
const layers = ref([]);   // [{ slide, generation }]
let removeOld = null;

function showSlide({ index, generation }) {
  layers.value = [...layers.value.slice(-1), { slide: props.slides[index], generation }];
  clearTimeout(removeOld);
  removeOld = setTimeout(() => { layers.value = layers.value.slice(-1); }, FADE_MS + 100);
}

// All timing lives in the clock; this component only shows what it asks for
const clock = createSlideshowClock({
  onChange: showSlide,
  onStuck: () => recoverByReloading('every slide keeps failing'),
});

// The same playlist is sent again after every reconnect; the clock ignores unchanged ones
watch(() => props.slides, (slides) => clock.setSlides(slides), { immediate: true });
// Server reachable again: retry at once instead of waiting out a failure pause
watch(() => props.connected, (up) => { if (up) clock.resume(); });

// A hidden, frozen or sleeping page can miss timers: check as soon as it's back. This doesn't
// depend on what the page reports about its own visibility (browsers can get that wrong), and
// it's harmless if nothing is overdue.
function resume() {
  clock.resume();
}
const PAGE_EVENTS = [
  [document, 'visibilitychange'],
  [document, 'resume'],   // Page Lifecycle: the page was frozen
  [window, 'pageshow'],
  [window, 'focus'],
  [window, 'online'],
];

onMounted(() => {
  clock.start();
  PAGE_EVENTS.forEach(([target, name]) => target.addEventListener(name, resume));
  // Read-only diagnostic, e.g. from remote DevTools: window.noticeboard.slideshow()
  window.noticeboard = { slideshow: () => clock.state() };
});
onUnmounted(() => {
  clock.stop();
  clearTimeout(removeOld);
  PAGE_EVENTS.forEach(([target, name]) => target.removeEventListener(name, resume));
  delete window.noticeboard;
});
</script>

<template>
  <div class="slideshow">
    <SlideFrame
      v-for="(layer, i) in layers"
      :key="layer.generation"
      :slide="layer.slide"
      :generation="layer.generation"
      :class="{ 'slide--fresh': i === layers.length - 1 }"
      @ready="clock.ready"
      @progress="clock.progress"
      @ended="clock.ended"
      @failed="clock.failed"
    />
  </div>
</template>

<style scoped>
.slideshow {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
}

/* The newest slide fades in over the previous one. A CSS animation runs by itself, with no
   script waiting on it, so it can never block the next slide. */
.slide--fresh {
  animation: slide-fade-in 0.4s ease both;
}
@keyframes slide-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
</style>
