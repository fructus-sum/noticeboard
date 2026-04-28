<script setup>
import SlideOverlay from './SlideOverlay.vue';

const props = defineProps({
  src:      { type: String, required: true },
  duration: { type: Number, default: null },
  overlay:  { type: Object, default: null },
});

const emit = defineEmits(['ready', 'error']);
</script>

<template>
  <div class="slide-wrap">
    <img
      :src="src"
      class="slide-img"
      draggable="false"
      @load="emit('ready')"
      @error="emit('error')"
    />
    <SlideOverlay v-if="overlay" :overlay="overlay" />
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
  object-fit: cover;
  display: block;
}
</style>
