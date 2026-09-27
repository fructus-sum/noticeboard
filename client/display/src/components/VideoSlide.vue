<script setup>
// client/display/src/components/VideoSlide.vue — a video slide, played muted to the end
//
// As large as fits the screen, whole and in its own shape (object-fit: contain), with the viewer's
// background colour around it.
//
// Props: src. Emits: ready (playback started), progress (it moved forward), ended, error (it
// can't play: refused by the autoplay policy, or unplayable).
// Used by: SlideFrame
// Uses: usePageWake (starts it again when the page wakes; the clock's stall deadline skips it if
// it still won't play)
import { ref, onMounted } from 'vue';
import { usePageWake } from '../composables/usePageWake.js';

defineProps({
  src: { type: String, required: true },
});

// ready: playback started; progress: it moved forward; error: it can't play
const emit = defineEmits(['ready', 'progress', 'ended', 'error']);
const video = ref(null);

function play() {
  const attempt = video.value?.play();
  // Refused (autoplay policy) or unplayable counts as an error; an interrupted play() doesn't
  attempt?.catch?.((err) => {
    if (err?.name !== 'AbortError') emit('error');
  });
}

// A hidden, frozen or sleeping page can pause the video: start it again when the page wakes.
// If it still won't play, the slide clock's stall deadline skips it.
usePageWake(() => {
  if (video.value?.paused && !video.value.ended) video.value.play()?.catch?.(() => {});
});

onMounted(play);
</script>

<template>
  <video
    ref="video"
    :src="src"
    class="slide-video"
    autoplay
    muted
    playsinline
    @playing="emit('ready')"
    @timeupdate="emit('progress')"
    @ended="emit('ended')"
    @error="emit('error')"
  />
</template>

<style scoped>
.slide-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: transparent;
  display: block;
}
</style>
