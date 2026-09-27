<script setup>
// client/display/src/components/ScreenDialog.vue — a dark card in the middle of the screen,
// readable whatever slide is behind it: the location pin's pop-up and the exit button's.
// Each user sets its own size, padding and text through its class; aria attributes pass through.
//
// Used by: DeviceInfo.vue, ExitKiosk.vue
</script>

<template>
  <div class="screen-dialog" role="dialog">
    <slot />
  </div>
</template>

<style scoped>
.screen-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;
  background: #111827;
  border: 1px solid #374151;
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  font-family: system-ui, -apple-system, sans-serif;
}
</style>
