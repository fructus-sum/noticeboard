<script setup>
import { ref } from 'vue';
import SlideOverlay from './SlideOverlay.vue';
import WatermarkOverlay from './WatermarkOverlay.vue';

const props = defineProps({
  src:       { type: String, required: true },
  overlay:   { type: Object, default: null },
  watermark: { type: Object, default: null },
});

const emit = defineEmits(['ended']);
const videoEl = ref(null);
const wrapEl  = ref(null);
const mediaStyle = ref({ left: '0px', top: '0px', width: '100%', height: '100%' });

function onMetadata() {
  const v = videoEl.value;
  const wrap = wrapEl.value;
  if (v && wrap && v.videoWidth) {
    const wW = wrap.clientWidth, wH = wrap.clientHeight;
    const ir = v.videoWidth / v.videoHeight, wr = wW / wH;
    let w, h, l, t;
    if (ir > wr) { w = wW; h = wW / ir; l = 0;            t = (wH - h) / 2; }
    else         { h = wH; w = wH * ir;  l = (wW - w) / 2; t = 0;           }
    mediaStyle.value = { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' };
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
