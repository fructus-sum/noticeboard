<script setup>
// client/display/src/components/CornerButton.vue — a small, faint round button in a top corner
// of the screen, above every slide: the location pin (top left) and the exit button (top right).
// Its icon goes in the slot; aria-label, title, v-show and click handlers pass through.
//
// Props: corner ('left' | 'right'), opacity (at rest), hoverOpacity (hovered or focused)
// Used by: DeviceInfo.vue, ExitKiosk.vue
defineProps({
  corner: { type: String, default: 'left' },
  opacity: { type: Number, default: 0.3 },
  hoverOpacity: { type: Number, default: 0.8 },
});
</script>

<template>
  <button
    type="button"
    class="corner-button"
    :class="`corner-button--${corner}`"
    :style="{ '--rest': opacity, '--hover': hoverOpacity }"
  >
    <slot />
  </button>
</template>

<style scoped>
.corner-button {
  position: fixed;
  top: 5px;
  z-index: 1000;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  opacity: var(--rest);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}
.corner-button--left { left: 5px; }
.corner-button--right { right: 5px; }
.corner-button:hover,
.corner-button:focus-visible { opacity: var(--hover); }
.corner-button :slotted(svg) { width: 14px; height: 14px; fill: currentColor; }
</style>
