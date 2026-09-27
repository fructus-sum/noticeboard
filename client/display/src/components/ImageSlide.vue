<script setup>
// How long it shows is the slide clock's business (slideshowClock.js), not this component's
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
  object-fit: cover;
  display: block;
}
</style>
