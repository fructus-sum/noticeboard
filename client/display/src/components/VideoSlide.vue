<script setup>
defineProps({
  src: { type: String, required: true },
});

const emit = defineEmits(['ended']);
</script>

<template>
  <video
    :src="src"
    class="slide-video"
    autoplay
    muted
    playsinline
    @ended="emit('ended')"
  />
</template>

<style scoped>
.slide-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
