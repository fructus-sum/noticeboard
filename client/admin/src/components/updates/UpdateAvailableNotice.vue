<script setup>
// client/admin/src/components/updates/UpdateAvailableNotice.vue — "Update available"
//
// Whenever a newer version waits to be installed, on any update schedule (SYSTEM_DESIGN §14 D41,
// §18.7 phase 2), every admin page says so, with when it will be installed (or, with manual
// updates, that it waits for the admin) and a link to Settings → Software updates, where it's
// installed now or given a time. There's nothing to close: it stays until this noticeboard runs the
// new version. The screens show their warning mark meanwhile (display:settings updateAvailable).
//
// Used by: App.vue (every page but the login page)
// Uses: useApi (GET /settings/updates), the helpers in useUpdateInfo
import { ref, computed, onMounted } from 'vue';
import { api } from '../../composables/useApi.js';
import { when } from '../../composables/useUpdateInfo.js';

const info = ref(null);
const waiting = computed(() => info.value?.waiting ?? null);
const manual = computed(() => info.value?.schedule?.every === 'manual');

onMounted(async () => {
  try {
    info.value = await api.get('/settings/updates');
  } catch {
    // Optional: the page works without it
  }
});
</script>

<template>
  <div v-if="waiting" class="page-warning" role="alert">
    <strong>Update available</strong>
    <p v-if="manual">
      A new version of the noticeboard is waiting. Updates are manual here: install it, or choose when, in
      <RouterLink to="/settings#updates">Settings → Software updates</RouterLink>.
    </p>
    <p v-else>
      A new version of the noticeboard is waiting<template v-if="waiting.nextInstall">: it's installed by itself at
      {{ when(waiting.nextInstall) }}</template>. To install it now, or choose another time, go to
      <RouterLink to="/settings#updates">Settings → Software updates</RouterLink>.
    </p>
  </div>
</template>

<style scoped>
.page-warning a { color: inherit; font-weight: 600; }
</style>
