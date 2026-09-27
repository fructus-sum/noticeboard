<script setup>
// client/admin/src/components/ui/TagPill.vue — a small grey label, e.g. "Hidden" or "Sample".
// The text goes in the slot; a title (tooltip) passes through.
// Used by: SlideshowsView, SlideshowDetailView
</script>

<template>
  <span class="tag"><slot /></span>
</template>

<style scoped>
.tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-muted);
  border: 1px solid var(--border);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
</style>
