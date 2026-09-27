<script setup>
// client/admin/src/components/ui/PublishToggle.vue — the "Disable" (red) / "Publish" (green) button
// Props: published (what it is now), busy (a change is on its way: disabled), small (the slideshow
// page's size). Click handlers pass through.
// Used by: SlideshowsView (and the slideshow page's settings card)
defineProps({
  published: Boolean,
  busy: Boolean,
  small: Boolean,
});
</script>

<template>
  <button
    type="button"
    class="publish-toggle"
    :class="[published ? 'publish-toggle--on' : 'publish-toggle--off', { 'publish-toggle--small': small, 'publish-toggle--busy': busy }]"
    :disabled="busy"
  >{{ published ? 'Disable' : 'Publish' }}</button>
</template>

<style scoped>
.publish-toggle {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: var(--radius);
  border: none;
  cursor: pointer;
  font-weight: 600;
}
.publish-toggle--small { font-size: 11px; padding: 3px 10px; }
.publish-toggle--busy { cursor: not-allowed; }
.publish-toggle--on { background: rgba(239, 68, 68, 0.12); color: #dc2626; outline: 1px solid rgba(239, 68, 68, 0.3); }
.publish-toggle--off { background: rgba(34, 197, 94, 0.12); color: #16a34a; outline: 1px solid rgba(34, 197, 94, 0.3); }
</style>
