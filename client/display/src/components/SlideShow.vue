<script setup>
// client/display/src/components/SlideShow.vue — the slides on screen, one after another
//
// Responsibilities
//   Shows what the slide clock asks for, fading each new slide in over the previous one (without
//   Vue's <Transition>: its leave step waits for animation frames, which a hidden page doesn't
//   produce). Retries straight away when the server is back, checks the clock when the page wakes,
//   and reloads the page as a last resort when it seems broken.
//
// Props
//   slides (the playlist), connected
// Emits
//   on-air(slide): the slide now on screen (its slideshow and a video's sound, for the background audio)
//
// Used by
//   App.vue
//
// Uses
//   slideshowClock.js, SlideFrame, usePageWake, recovery.js (recoverByReloading)
import { ref, watch, onMounted, onUnmounted } from 'vue';
import SlideFrame from './SlideFrame.vue';
import { createSlideshowClock } from '../slideshowClock.js';
import { recoverByReloading } from '../recovery.js';
import { usePageWake } from '../composables/usePageWake.js';

const props = defineProps({
  slides: { type: Array, required: true },
  connected: { type: Boolean, default: true },
});
const emit = defineEmits(['on-air']);

// Slides on screen, oldest first: each new slide fades in on top of the previous one, which
// a timer then removes. This deliberately avoids Vue's <Transition>: its leave step waits for
// animation frames, which a hidden page or a switched-off screen doesn't produce, and that
// could hold back every following slide.
const FADE_MS = 400;
const layers = ref([]);   // [{ slide, generation }]
let removeOld = null;

function showSlide({ index, generation }) {
  layers.value = [...layers.value.slice(-1), { slide: props.slides[index], generation }];
  emit('on-air', props.slides[index] ?? null);
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

// A hidden, frozen or sleeping page can miss timers: check as soon as it's back (or back
// online). It's harmless if nothing is overdue.
usePageWake(() => clock.resume(), { online: true });

onMounted(() => {
  clock.start();
  // Read-only diagnostic, e.g. from remote DevTools: window.noticeboard.slideshow()
  window.noticeboard = { slideshow: () => clock.state() };
});
onUnmounted(() => {
  clock.stop();
  clearTimeout(removeOld);
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
  background: var(--nb-background, #000);
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
