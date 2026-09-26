<script setup>
import { ref } from 'vue';
import SlideOverlay from './SlideOverlay.vue';
import WatermarkOverlay from './WatermarkOverlay.vue';
import { useMediaFit } from '../composables/useMediaFit.js';

const props = defineProps({
  src:       { type: String, required: true },
  duration:  { type: Number, default: null },
  overlay:   { type: Object, default: null },
  watermark: { type: Object, default: null },
});

const emit = defineEmits(['ready', 'error']);
const imgEl  = ref(null);
const wrapEl = ref(null);
const { mediaStyle, computeFit } = useMediaFit();

function onLoad() {
  const img = imgEl.value;
  const wrap = wrapEl.value;
  if (img && wrap) {
    computeFit(img.naturalWidth, img.naturalHeight, wrap.clientWidth, wrap.clientHeight);
  }
  emit('ready');
}
</script>

<template>
  <div class="slide-wrap" ref="wrapEl">
    <img
      ref="imgEl"
      :src="src"
      class="slide-img"
      draggable="false"
      @load="onLoad"
      @error="emit('error')"
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
.slide-img {
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
