<script setup>
import SlideOverlay from './SlideOverlay.vue';
import WatermarkOverlay from './WatermarkOverlay.vue';

const props = defineProps({
  src:       { type: String, required: true },
  overlay:   { type: Object, default: null },
  watermark: { type: Object, default: null },
});

const emit = defineEmits(['ended']);
</script>

<template>
  <div class="slide-wrap">
    <video
      :src="src"
      class="slide-video"
      autoplay
      muted
      playsinline
      @ended="emit('ended')"
    />
    <SlideOverlay v-if="overlay" :overlay="overlay" />
    <WatermarkOverlay v-if="watermark" :watermark="watermark" />
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
  object-fit: cover;
  display: block;
}
</style>
