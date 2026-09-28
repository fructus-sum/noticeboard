<script setup>
// client/admin/src/components/settings/RestartNotice.vue — "Restart the Server", on every admin page
//
// Responsibilities
//   Like the installer box: while a saved setting only takes effect after a restart (today the port),
//   an amber box says so and what follows (each Client's installer run again with the new address,
//   the firewall), with "Restart the Server now…": the admin password and a last chance (the shared
//   ConfirmDangerDialogs), then POST /settings/maintenance/restart. The Server stops and systemd
//   starts it again; this page waits until it answers on its (new) port and goes there. Nothing to
//   close: the box goes when the Server runs with the saved settings (SYSTEM_DESIGN §18.5 item 4).
//
// Used by: App.vue (every page but the login page)
// Uses: useApi, useRestartState, ConfirmDangerDialogs
import { ref, computed, onMounted } from 'vue';
import { api } from '../../composables/useApi.js';
import { useRestartState } from '../../composables/useRestartState.js';
import ConfirmDangerDialogs from '../ui/ConfirmDangerDialogs.vue';

const { state, refresh } = useRestartState();
const confirmRestart = ref(null);
const restarting = ref(false);
const note = ref('');

const running = computed(() => state.value?.port?.running);
const saved = computed(() => state.value?.port?.saved);
const newAddress = computed(() => `${location.protocol}//${location.hostname}:${saved.value}`);

onMounted(refresh);

const verify = async (password) => (await api.post('/settings/maintenance/verify-password', { password, action: 'restart' })).token;
const restart = (token) => api.post('/settings/maintenance/restart', { token });

// Wait for the Server on its new address (another origin: an opaque answer is enough), then go there
async function restarted() {
  restarting.value = true;
  const target = newAddress.value;
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 90; i++) {
    try {
      await fetch(`${target}/api/auth/status`, { mode: 'no-cors', cache: 'no-store' });
      location.href = `${target}/admin/settings`;
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  note.value = `The Server hasn't answered at ${target} yet. If it was started by hand rather than as the Noticeboard service, start it again; otherwise wait a little and open that address.`;
}
</script>

<template>
  <div v-if="state?.restartNeeded" class="restart page-warning" role="alert">
    <strong>Restart the Server</strong>
    <p>
      The port was changed from {{ running }} to {{ saved }}. It takes effect when the Server restarts; until then,
      everything keeps using port {{ running }}.
    </p>
    <p>
      After the restart, the admin panel and the viewer are at <code>{{ newAddress }}</code>. Run the installer again on
      each Client and give it that address, and allow port {{ saved }} through any firewall on the Server.
    </p>
    <p v-if="restarting && !note">Restarting… this page moves to the new address as soon as the Server answers there.</p>
    <p v-else-if="note">{{ note }}</p>
    <div v-else>
      <button type="button" class="btn-primary" @click="confirmRestart.open()">Restart the Server now…</button>
    </div>
  </div>

  <ConfirmDangerDialogs
    ref="confirmRestart"
    id-prefix="restart"
    title="Restart the Server?"
    :verify="verify"
    :confirm="restart"
    cancel-label="Cancel, not now"
    confirm-label="Confirm, restart now"
    busy-label="Restarting…"
    @cancelled="refresh"
    @failed="(message) => { note = message; }"
    @done="restarted"
  >
    <p>
      The Server stops and starts again straight away, on port {{ saved }}. Screens go blank for a few seconds and
      the Server's own screen reloads by itself; each Client needs its installer run again with the new address.
    </p>
    <template #final>
      <p>This is your last chance to back out:</p>
      <ul class="choices">
        <li><strong>Cancel</strong> keeps everything running on port {{ running }}.</li>
        <li><strong>Confirm</strong> restarts the Server now, on port {{ saved }}.</li>
      </ul>
    </template>
  </ConfirmDangerDialogs>
</template>

<style scoped>
.restart p { margin: 6px 0; font-size: 13px; }
.restart code { font-size: 12px; }
</style>
