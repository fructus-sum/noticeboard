<script setup>
// client/admin/src/components/updates/UpdateAvailableNotice.vue — "Update available" (manual updates)
//
// With manual updates, a new version waits until the admin installs it, so every admin page says
// so, with a link to Settings → Software updates, where it's installed or given a time
// (SYSTEM_DESIGN §14 D41). There's nothing to close: it stays until this noticeboard runs the new
// version. The screens show their warning mark meanwhile (display:settings updateAvailable).
//
// Used by: App.vue (every page but the login page)
// Uses: useApi (GET /settings/updates)
import { ref, onMounted } from 'vue';
import { api } from '../../composables/useApi.js';

const show = ref(false);

onMounted(async () => {
  try {
    const info = await api.get('/settings/updates');
    show.value = info?.schedule?.every === 'manual' && !!info.waiting;
  } catch {
    // Optional: the page works without it
  }
});
</script>

<template>
  <div v-if="show" class="page-warning" role="alert">
    <strong>Update available</strong>
    <p>
      A new version of the noticeboard is waiting. Updates are manual here: install it, or choose when, in
      <RouterLink to="/settings#updates">Settings → Software updates</RouterLink>.
    </p>
  </div>
</template>

<style scoped>
.page-warning a { color: inherit; font-weight: 600; }
</style>
