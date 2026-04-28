<script setup>
import { onMounted } from 'vue';
import SlideOverlay from './SlideOverlay.vue';
import WatermarkOverlay from './WatermarkOverlay.vue';

const props = defineProps({
  bgColor:   { type: String, default: '#000000' },
  overlay:   { type: Object, default: null },
  watermark: { type: Object, default: null },
  duration:  { type: Number, default: null },
});

const emit = defineEmits(['ready']);

onMounted(() => emit('ready'));
</script>

<template>
  <div class="text-slide" :style="{ background: bgColor }">
    <SlideOverlay v-if="overlay" :overlay="overlay" />
    <WatermarkOverlay v-if="watermark" :watermark="watermark" />
  </div>
</template>

<style scoped>
.text-slide {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
