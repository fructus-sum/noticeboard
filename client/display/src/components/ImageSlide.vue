<script setup>
// client/display/src/components/ImageSlide.vue — an image slide, as large as fits the screen
//
// Whole and in its own shape (object-fit: contain): never cut off or stretched; the viewer's
// background colour shows around it. How long it shows is the slide clock's business
// (slideshowClock.js), not this component's.
// Props: src. Emits: ready (loaded), error.
// Used by: SlideFrame
defineProps({
  src: { type: String, required: true },
});

const emit = defineEmits(['ready', 'error']);
</script>

<template>
  <img
    :src="src"
    class="slide-img"
    draggable="false"
    @load="emit('ready')"
    @error="emit('error')"
  />
</template>

<style scoped>
.slide-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
</style>
