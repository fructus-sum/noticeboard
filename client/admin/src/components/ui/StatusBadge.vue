<script setup>
// client/admin/src/components/ui/StatusBadge.vue — "Published" (green) or "Disabled" (grey)
// Used by: SlideshowsView, slideshow/SlideshowSettingsCard
defineProps({ published: Boolean });
</script>

<template>
  <span class="status-badge" :class="published ? 'status-badge--on' : 'status-badge--off'">
    {{ published ? 'Published' : 'Disabled' }}
  </span>
</template>

<style scoped>
.status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.status-badge--on { background: rgba(34, 197, 94, 0.15); color: #16a34a; border: 1px solid rgba(34, 197, 94, 0.35); }
.status-badge--off { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); border: 1px solid rgba(148, 163, 184, 0.25); }
</style>
