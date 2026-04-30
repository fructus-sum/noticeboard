<script setup>
defineProps({
  overlay: { type: Object, required: true },
});
</script>

<template>
  <div
    class="overlay"
    :style="{
      left:       overlay.x + '%',
      top:        overlay.y + '%',
      fontFamily: overlay.fontFamily,
      '--font-size': overlay.fontSize,
      color:      overlay.color,
      textAlign:  overlay.align,
      background: overlay.bgColor ?? 'transparent',
    }"
  >{{ overlay.text }}</div>
</template>

<style scoped>
.overlay {
  position: absolute;
  font-size: calc(var(--font-size, 16) * 1px * var(--slide-scale, 1));
  transform: translate(-50%, -50%);
  white-space: pre-wrap;
  padding: 6px 14px;
  border-radius: 6px;
  pointer-events: none;
  max-width: 80%;
  word-break: break-word;
  line-height: 1.3;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  z-index: 10;
}
</style>
