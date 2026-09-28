<script setup>
// client/display/src/components/VideoSlide.vue — a video slide, played to the end, muted unless it has sound
//
// As large as fits the screen, whole and in its own shape (object-fit: contain), with the viewer's
// background colour around it.
//
// Props: src, sound (play its own sound: SYSTEM_DESIGN §18.3; if the browser refuses sound, it
// plays muted instead, so the slide still plays and keeps to time).
// Emits: ready (playback started), progress (it moved forward), ended, error (it can't play:
// refused by the autoplay policy even muted, or unplayable).
// Used by: SlideFrame
// Uses: usePageWake (starts it again when the page wakes; the clock's stall deadline skips it if
// it still won't play)
import { ref, onMounted } from 'vue';
import { usePageWake } from '../composables/usePageWake.js';

const props = defineProps({
  src: { type: String, required: true },
  sound: { type: Boolean, default: false },
});

// ready: playback started; progress: it moved forward; error: it can't play
const emit = defineEmits(['ready', 'progress', 'ended', 'error']);
const video = ref(null);

function play() {
  const el = video.value;
  if (!el) return;
  el.muted = !props.sound;
  const attempt = el.play();
  // Refused (autoplay policy) or unplayable counts as an error; an interrupted play() doesn't.
  // A video with sound that the browser won't play aloud plays muted instead.
  attempt?.catch?.((err) => {
    if (err?.name === 'NotAllowedError' && !el.muted) {
      el.muted = true;
      el.play()?.catch?.((again) => { if (again?.name !== 'AbortError') emit('error'); });
      return;
    }
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
