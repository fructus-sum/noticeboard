<script setup>
import { computed } from 'vue';

const props = defineProps({
  watermark: { type: Object, required: true },
});

const positionStyle = computed(() => {
  switch (props.watermark.position) {
    case 'top-left':     return { top: '2%',  left: '2%' };
    case 'top-right':    return { top: '2%',  right: '2%' };
    case 'bottom-left':  return { bottom: '2%', left: '2%' };
    case 'bottom-right':
    default:             return { bottom: '2%', right: '2%' };
  }
});
</script>

<template>
  <img
    :src="watermark.url"
    class="watermark"
    :style="{
      ...positionStyle,
      width:   watermark.size + '%',
      opacity: watermark.opacity,
    }"
    draggable="false"
  />
</template>

<style scoped>
.watermark {
  position: absolute;
  pointer-events: none;
  object-fit: contain;
  z-index: 20;
  max-width: 30%;
}
</style>
