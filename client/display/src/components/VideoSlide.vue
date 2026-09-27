<script setup>
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
  object-fit: cover;
  display: block;
}
</style>
