<script setup>
import { ref } from 'vue';
import SlideOverlay from './SlideOverlay.vue';
import WatermarkOverlay from './WatermarkOverlay.vue';
import { useMediaFit } from '../composables/useMediaFit.js';

const props = defineProps({
  src:       { type: String, required: true },
  overlay:   { type: Object, default: null },
  watermark: { type: Object, default: null },
});

const emit = defineEmits(['ended']);
const videoEl = ref(null);
const wrapEl  = ref(null);
const { mediaStyle, computeFit } = useMediaFit();

function onMetadata() {
  const v = videoEl.value;
  const wrap = wrapEl.value;
  if (v && wrap) {
    computeFit(v.videoWidth, v.videoHeight, wrap.clientWidth, wrap.clientHeight);
  }
}
</script>

<template>
  <div class="slide-wrap" ref="wrapEl">
    <video
      ref="videoEl"
      :src="src"
      class="slide-video"
      autoplay
      muted
      playsinline
      @loadedmetadata="onMetadata"
      @ended="emit('ended')"
    />
    <div class="media-region" :style="mediaStyle">
      <SlideOverlay v-if="overlay" :overlay="overlay" />
      <WatermarkOverlay v-if="watermark" :watermark="watermark" />
    </div>
  </div>
</template>

<style scoped>
.slide-wrap {
  position: absolute;
  inset: 0;
}
.slide-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.media-region {
  position: absolute;
}
</style>
