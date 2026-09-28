<script setup>
// client/admin/src/components/updates/SwitchDialogs.vue — the confirmations before a branch switch
//
// Responsibilities
//   "Missing software" (only when the branch needs software this noticeboard lacks: tick to
//   accept), then the shared confirmation steps (ConfirmDangerDialogs): the warnings and the admin
//   password (POST /settings/updates/verify-password, which gives a one-time token), then the final
//   "last chance" (POST /settings/updates/switch). Esc, a click outside or Cancel ends it with
//   nothing changed.
//
// Props: info (GET /settings/updates)
// Exposes: open(checked), which starts the steps for a checked branch (from BranchSwitcher)
// Emits: cancelled(note), failed(message) (a wrong password, too many tries, or the switch refused),
//        switched(info), the updates info the switch returned
//
// Used by: SoftwareUpdates
// Uses: useApi, ModalDialog (Missing software), ConfirmDangerDialogs, the helpers in useUpdateInfo
import { ref, computed, nextTick } from 'vue';
import { api } from '../../composables/useApi.js';
import { short, runningName, missingSoftware } from '../../composables/useUpdateInfo.js';
import ModalDialog from '../ui/ModalDialog.vue';
import ConfirmDangerDialogs from '../ui/ConfirmDangerDialogs.vue';

const props = defineProps({ info: { type: Object, default: null } });
const emit = defineEmits(['cancelled', 'failed', 'switched']);

const CANCELLED = 'Cancelled. Nothing was changed.';

const software = ref(false);       // the Missing software step is showing
const target = ref(null);          // the checked branch
const acceptMissing = ref(false);  // the extra confirmation when software the branch needs is missing
const confirmSteps = ref(null);

const running = computed(() => runningName(props.info));
const missing = computed(() => missingSoftware(target.value));

function open(checked) {
  target.value = checked;
  if (missing.value.length) {
    acceptMissing.value = false;
    software.value = true;
    return;
  }
  toPassword();
}
defineExpose({ open });

async function toPassword() {
  software.value = false;
  await nextTick();
  confirmSteps.value.open();
}

function cancelSoftware() {
  software.value = false;
  emit('cancelled', CANCELLED);
}

const verify = async (password) =>
  (await api.post('/settings/updates/verify-password', { password, branch: target.value.branch })).token;

const confirmSwitch = (token) => api.post('/settings/updates/switch', {
  branch: target.value.branch,
  token,
  acceptMissing: missing.value.length > 0 && acceptMissing.value,
});

function switched(info) {
  target.value = null;
  emit('switched', info);
}
</script>

<template>
  <!-- Extra confirmation: software the branch needs is missing -->
  <ModalDialog v-if="software" class="danger-dialog" tag="form" labelledby="software-title" @close="cancelSoftware" @submit.prevent="toPassword">
    <h2 id="software-title">Missing software</h2>
    <p>
      <strong>{{ target.branch }}</strong> needs software this noticeboard doesn’t have, or has in a version that’s too old.
      Install it yourself before switching: until you do, the branch may not work.
    </p>
    <ul class="warnings">
      <li v-for="r in missing" :key="r.name">
        <strong>{{ r.name }}</strong> {{ r.required }} (this noticeboard has {{ r.installed ? r.found : 'none' }}).
        {{ r.neededFor }} To install: <code>{{ r.install }}</code>
      </li>
    </ul>
    <label class="accept">
      <input v-model="acceptMissing" type="checkbox" />
      I’ve installed it myself, or I accept that {{ target.branch }} may not work until I do.
    </label>
    <div class="actions">
      <button type="button" class="btn-ghost" @click="cancelSoftware">Cancel</button>
      <button type="submit" class="btn-primary" :disabled="!acceptMissing">Continue</button>
    </div>
  </ModalDialog>

  <ConfirmDangerDialogs
    ref="confirmSteps"
    id-prefix="switch"
    :title="target ? `Switch to ${target.branch}?` : ''"
    :verify="verify"
    :confirm="confirmSwitch"
    :cancel-label="`Cancel, keep ${running}`"
    :confirm-label="target ? `Confirm, switch to ${target.branch}` : ''"
    @cancelled="(note) => emit('cancelled', note)"
    @failed="(message) => emit('failed', message)"
    @done="switched"
  >
    <template v-if="target">
      <p class="change">
        <strong>{{ running }}</strong> <code>{{ short(info.commit) }}</code> →
        <strong>{{ target.branch }}</strong> <code>{{ short(target.commit) }}</code>
      </p>
      <ul class="warnings">
        <li><strong>Experimental.</strong> Branches other than main hold work in progress. They may be unfinished or untested.</li>
        <li><strong>May not work here.</strong> A branch can expect settings, files or system packages this noticeboard doesn't have.</li>
        <li><strong>May be unstable.</strong> Slideshows, screens, the admin panel or updates may misbehave until you switch back.</li>
        <li>
          <strong>Your data.</strong> Slideshows, slides and settings are kept, and the settings are backed up first (in
          data/backups on the Server). But a branch may change how it stores them, and switching back doesn't undo that.
        </li>
        <li><strong>Future updates</strong> come from {{ target.branch }} until you switch back.</li>
      </ul>
    </template>

    <template v-if="target" #final>
      <p>
        Your password checked out, so the only thing between this noticeboard and <strong>{{ target.branch }}</strong>
        is you and this button.
      </p>
      <p v-if="missing.length" class="tone-warn">
        Remember: this noticeboard is still missing {{ missing.map((r) => r.name).join(', ') }}.
      </p>
      <p v-if="target.installer?.needed" class="tone-warn">
        Afterwards, run the installer again on the Server: the admin panel will show how.
      </p>
      <p>This is your last chance to back out:</p>
      <ul class="choices">
        <li><strong>Cancel</strong> leaves everything exactly as it is: still {{ running }}, nothing changed.</li>
        <li>
          <strong>Confirm</strong> starts the switch
          {{ info.instant ? 'straight away' : 'at the next update check (within 15 minutes)' }}. The noticeboard
          restarts once the new version is built; screens go blank for a few seconds, then reload by themselves.
        </li>
      </ul>
    </template>
  </ConfirmDangerDialogs>
</template>

<style scoped>
/* The overlay and card are ModalDialog's; the shared confirmation styles are .danger-dialog's */
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.change { font-size: 14px; }
.accept { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 16px; }
.accept input { width: auto; margin-top: 2px; }
</style>
