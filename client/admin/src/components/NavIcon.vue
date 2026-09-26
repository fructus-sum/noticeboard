<script setup>
// Line icons for the sidebar, drawn in the text colour
defineProps({ name: { type: String, required: true } });

const ICONS = {
  collapse: '<path d="M15 6l-6 6 6 6"/><path d="M20 4v16"/>',
  expand: '<path d="M9 6l6 6-6 6"/><path d="M4 4v16"/>',
  slideshows: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.4v.5"/><path d="M12 16.8v.2"/>',
  viewer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  updated: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/>',
};
</script>

<template>
  <svg
    class="nav-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="ICONS[name]"
  />
</template>

<style scoped>
.nav-icon { width: 20px; height: 20px; flex: none; }
</style>
