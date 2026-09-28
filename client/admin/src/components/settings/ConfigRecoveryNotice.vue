<script setup>
// client/admin/src/components/settings/ConfigRecoveryNotice.vue — "The settings file couldn't be read"
//
// Responsibilities
//   When config.json couldn't be read at start-up (SYSTEM_DESIGN §18.5 item 8), an amber box on
//   every admin page says what happened: the unreadable file was kept (its name), and either the
//   last good copy was restored, or the noticeboard started from its defaults (the default password,
//   no MAC filtering, no slideshows listed; the slideshows' folders are untouched). It stays until
//   the admin clicks "I've dealt with it" (DELETE /settings/config-recovery).
//
// Used by: App.vue (every page but the login page)
// Uses: useApi (GET/DELETE /settings/config-recovery)
import { ref, onMounted } from 'vue';
import { api } from '../../composables/useApi.js';

const recovery = ref(null);
const busy = ref(false);

onMounted(async () => {
  try {
    recovery.value = (await api.get('/settings/config-recovery')).recovery;
  } catch {
    // Optional: the page works without it
  }
});

async function dismiss() {
  busy.value = true;
  try {
    recovery.value = (await api.del('/settings/config-recovery')).recovery;
  } catch {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="recovery" class="config-recovery page-warning" role="alert">
    <strong>The settings file couldn't be read</strong>
    <p>
      When the Server started ({{ new Date(recovery.time).toLocaleString() }}), <code>data/config.json</code> couldn't be
      read. It wasn't overwritten: it was kept as <code>data/{{ recovery.brokenFile }}</code>.
    </p>
    <p v-if="recovery.restored === 'last-good'">
      The last copy that worked was put back, so the settings are as they were when they were last saved. Check them,
      then click the button below.
    </p>
    <p v-else>
      There was no earlier copy, so the noticeboard started from its defaults: the admin password is the default one,
      MAC filtering is off and no slideshows or audio shows are listed (their folders in <code>data/</code> are untouched).
      Mend the kept file and restart the Server to go back to it, or carry on and set things up again.
    </p>
    <button type="button" class="btn-ghost" :disabled="busy" @click="dismiss">I've dealt with it</button>
  </div>
</template>

<style scoped>
.config-recovery code { font-size: 12px; }
</style>
