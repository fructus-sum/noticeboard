<script setup>
const props = defineProps({
  src: { type: String, required: true },
  duration: { type: Number, default: null },
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
