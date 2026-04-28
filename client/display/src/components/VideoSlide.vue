<script setup>
import SlideOverlay from './SlideOverlay.vue';

const props = defineProps({
  src:     { type: String, required: true },
  overlay: { type: Object, default: null },
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
