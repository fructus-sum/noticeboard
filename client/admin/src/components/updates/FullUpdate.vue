<script setup>
// client/admin/src/components/updates/FullUpdate.vue — Full update: the installer's system step, then the code again
//
// Responsibilities
//   On main, with root's system step set up (installer version 6), "Full update…": the installer of
//   main's latest Release runs as root (packages, services, this Server's Client, with the answers
//   saved at install), then that Release is installed again (SYSTEM_DESIGN §18.7 phase 2). The
//   admin password, then a final confirmation (ConfirmDangerDialogs, action 'full-update'); update.sh
//   does the rest. Also the last system step's answer. Following a branch, or on main before the system
//   step is set up, it says how to run the installer by hand instead; nothing while a switch to main is
//   still on its way.
//
// Props: info (GET /settings/updates)
// Emits: started(info) (the Full update was asked for: the new updates info), cancelled(note),
//        failed(message)
//
// Used by: SoftwareUpdates
// Uses: useApi (POST /settings/maintenance/verify-password, /settings/maintenance/full-update),
//   ConfirmDangerDialogs, the helpers in useUpdateInfo, installerCommand from @shared
import { ref, computed } from 'vue';
import { installerCommand } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { when } from '../../composables/useUpdateInfo.js';
import ConfirmDangerDialogs from '../ui/ConfirmDangerDialogs.vue';

const props = defineProps({
  info: { type: Object, required: true },
});
const emit = defineEmits(['started', 'cancelled', 'failed']);

const dialogs = ref(null);
// Following main (the setting), and running it (not a switch still on its way)
const followsMain = computed(() => props.info.configuredBranch === 'main');
const onMain = computed(() => followsMain.value && props.info.branch === 'main');
const ready = computed(() => onMain.value && props.info.systemStep);
const last = computed(() => props.info.lastSystemStep);
const command = computed(() => installerCommand((onMain.value && props.info.release) || props.info.configuredBranch));

const verify = async (password) =>
  (await api.post('/settings/maintenance/verify-password', { password, action: 'full-update' })).token;
const confirm = (token) => api.post('/settings/maintenance/full-update', { token });
</script>

<template>
  <div v-if="onMain || !followsMain" class="full-update">
    <h3>Full update</h3>
    <template v-if="ready">
      <p class="muted">
        Runs the installer of main's latest Release on the Server (the system packages it needs, its services, and this
        Server's own screen), then installs that Release again. Use it if something the installer set up needs
        repairing. The noticeboard keeps running until it restarts.
      </p>
      <p v-if="last" class="muted">
        Last run {{ when(last.time) }}: {{ last.message }}
      </p>
      <button type="button" class="btn-ghost" :disabled="info.busy" @click="dialogs.open()">Full update…</button>
    </template>
    <p v-else-if="onMain" class="muted">
      Updates that need the installer run it by themselves once it has been run by hand one more time. In a terminal on
      the Server, or over SSH: <code class="command">{{ command }}</code>
    </p>
    <p v-else class="muted">
      This noticeboard follows <strong>{{ info.configuredBranch }}</strong>, so when it needs the installer, run it by
      hand (only main's Releases run it by themselves). In a terminal on the Server, or over SSH:
      <code class="command">{{ command }}</code>
    </p>

    <ConfirmDangerDialogs
      ref="dialogs"
      id-prefix="full-update"
      title="Run a full update?"
      :verify="verify"
      :confirm="confirm"
      cancel-label="Cancel, change nothing"
      confirm-label="Confirm, run a full update"
      busy-label="Starting…"
      @cancelled="(note) => emit('cancelled', note)"
      @failed="(message) => emit('failed', message)"
      @done="(newInfo) => emit('started', newInfo)"
    >
      <p>This noticeboard will:</p>
      <ul class="warnings">
        <li>
          <strong>Run the installer of main's latest Release, as the Server's administrator:</strong> it installs the
          system packages that Release needs and sets up its services and the Server's own screen again, with the
          answers given when it was installed.
        </li>
        <li>
          <strong>Install that Release again</strong> and restart. The screens go blank for a few seconds, then reload by
          themselves.
        </li>
      </ul>
      <p>Your slideshows, audio shows and settings are kept.</p>

      <template #final>
        <p>Your password checked out. This is your last chance to back out:</p>
        <ul class="choices">
          <li><strong>Cancel</strong> leaves everything exactly as it is.</li>
          <li><strong>Confirm</strong> starts the full update. It takes a few minutes.</li>
        </ul>
      </template>
    </ConfirmDangerDialogs>
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; }
h3 { font-size: 0.95rem; font-weight: 600; margin: 18px 0 6px; }
.full-update p { margin-bottom: 10px; }
.command { display: inline-block; font-size: 12px; background: var(--surface-2); padding: 2px 6px; border-radius: 4px; overflow-wrap: anywhere; }
</style>
