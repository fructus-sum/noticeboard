<script setup>
import { ref } from 'vue';
import SlideOverlay from './SlideOverlay.vue';
import WatermarkOverlay from './WatermarkOverlay.vue';

const props = defineProps({
  src:       { type: String, required: true },
  duration:  { type: Number, default: null },
  overlay:   { type: Object, default: null },
  watermark: { type: Object, default: null },
});

const emit = defineEmits(['ready', 'error']);
const imgEl  = ref(null);
const wrapEl = ref(null);
const mediaStyle = ref({ left: '0px', top: '0px', width: '100%', height: '100%' });

function onLoad() {
  const img = imgEl.value;
  const wrap = wrapEl.value;
  if (img && wrap && img.naturalWidth) {
    const wW = wrap.clientWidth, wH = wrap.clientHeight;
    const ir = img.naturalWidth / img.naturalHeight, wr = wW / wH;
    let w, h, l, t;
    if (ir > wr) { w = wW; h = wW / ir; l = 0;            t = (wH - h) / 2; }
    else         { h = wH; w = wH * ir;  l = (wW - w) / 2; t = 0;           }
    mediaStyle.value = { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' };
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
