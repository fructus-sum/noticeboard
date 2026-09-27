<script setup>
// client/admin/src/components/updates/SwitchDialogs.vue — the confirmations before a branch switch
//
// Responsibilities
//   The steps, each a ModalDialog: "Missing software" (only when the branch needs software this
//   noticeboard lacks: tick to accept), then the warnings and the admin password
//   (POST /settings/updates/verify-password, which gives a one-time token), then the final
//   "last chance" (POST /settings/updates/switch). Esc, a click outside or Cancel ends it with
//   nothing changed; while a password check or the switch is on its way it can't be cancelled.
//   The password field, then the final Cancel button, get the focus (the safe choice is the default).
//
// Props: info (GET /settings/updates)
// Exposes: open(checked), which starts the steps for a checked branch (from BranchSwitcher)
// Emits: cancelled(note), failed(message) (a wrong password, too many tries, or the switch refused),
//        switched(info), the updates info the switch returned
//
// Used by: SoftwareUpdates
// Uses: useApi, ModalDialog, the helpers in useUpdateInfo
import { ref, computed, nextTick } from 'vue';
import { api } from '../../composables/useApi.js';
import { short, runningName, missingSoftware } from '../../composables/useUpdateInfo.js';
import ModalDialog from '../ui/ModalDialog.vue';

const props = defineProps({ info: { type: Object, default: null } });
const emit = defineEmits(['cancelled', 'failed', 'switched']);

const CANCELLED = 'Cancelled. Nothing was changed.';

const step = ref('');              // '' | 'software' | 'password' | 'final'
const target = ref(null);          // the checked branch
const acceptMissing = ref(false);  // the extra confirmation when software the branch needs is missing
const password = ref('');
const verifying = ref(false);
const token = ref('');
const switching = ref(false);
const passwordInput = ref(null);
const cancelFinal = ref(null);

const running = computed(() => runningName(props.info));
const missing = computed(() => missingSoftware(target.value));

function open(checked) {
  target.value = checked;
  next();
}
defineExpose({ open });

// Missing software first, if any; then the warnings and the admin password
async function next() {
  password.value = '';
  if (missing.value.length && step.value !== 'software') {
    acceptMissing.value = false;
    step.value = 'software';
    return;
  }
  step.value = 'password';
  await nextTick();
  passwordInput.value?.focus();
}

function cancel(note) {
  if (verifying.value || switching.value) return;   // an answer is on its way
  step.value = '';
  password.value = '';
  token.value = '';
  emit('cancelled', note);
}

async function verifyPassword() {
  if (!password.value) return;
  verifying.value = true;
  try {
    const res = await api.post('/settings/updates/verify-password', { password: password.value, branch: target.value.branch });
    token.value = res.token;
    password.value = '';
    step.value = 'final';
    await nextTick();
    cancelFinal.value?.focus();
  } catch (e) {
    // Wrong password (or too many tries): the switch is cancelled, nothing changes
    step.value = '';
    password.value = '';
    emit('failed', e.message);
  } finally {
    verifying.value = false;
  }
}

// The final confirmation: start the switch
async function confirmSwitch() {
  switching.value = true;
  try {
    const info = await api.post('/settings/updates/switch', {
      branch: target.value.branch,
      token: token.value,
      acceptMissing: missing.value.length > 0 && acceptMissing.value,
    });
    step.value = '';
    token.value = '';
    target.value = null;
    emit('switched', info);
  } catch (e) {
    step.value = '';
    token.value = '';
    emit('failed', e.message);
  } finally {
    switching.value = false;
  }
}
</script>

<template>
  <!-- Extra confirmation: software the branch needs is missing -->
  <ModalDialog v-if="step === 'software'" tag="form" labelledby="software-title" @close="cancel(CANCELLED)" @submit.prevent="next">
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
      <button type="button" class="btn-ghost" @click="cancel(CANCELLED)">Cancel</button>
      <button type="submit" class="btn-primary" :disabled="!acceptMissing">Continue</button>
    </div>
  </ModalDialog>

  <!-- First confirmation: warnings and the admin password -->
  <ModalDialog v-if="step === 'password'" tag="form" labelledby="switch-title" @close="cancel(CANCELLED)" @submit.prevent="verifyPassword">
    <h2 id="switch-title">Switch to {{ target.branch }}?</h2>
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
        data/backups on the Pi). But a branch may change how it stores them, and switching back doesn't undo that.
      </li>
      <li><strong>Future updates</strong> come from {{ target.branch }} until you switch back.</li>
    </ul>
    <div class="field">
      <label for="switch-password">Admin password</label>
      <input id="switch-password" ref="passwordInput" v-model="password" type="password" autocomplete="current-password" required />
    </div>
    <div class="actions">
      <button type="button" class="btn-ghost" :disabled="verifying" @click="cancel(CANCELLED)">Cancel</button>
      <button type="submit" class="btn-primary" :disabled="verifying || !password">{{ verifying ? 'Checking…' : 'Continue' }}</button>
    </div>
  </ModalDialog>

  <!-- Final confirmation -->
  <ModalDialog v-if="step === 'final'" role="alertdialog" labelledby="final-title" describedby="final-body" @close="cancel(CANCELLED)">
    <h2 id="final-title">Last chance to avoid doing something stupid!</h2>
    <div id="final-body">
      <p>
        Your password checked out, so the only thing between this noticeboard and <strong>{{ target.branch }}</strong>
        is you and this button.
      </p>
      <p v-if="missing.length" class="tone-warn">
        Remember: this noticeboard is still missing {{ missing.map((r) => r.name).join(', ') }}.
      </p>
      <p v-if="target.installer?.needed" class="tone-warn">
        Afterwards, run the installer again on this Pi: the admin panel will show how.
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
    </div>
    <div class="actions">
      <button ref="cancelFinal" type="button" class="btn-ghost" :disabled="switching" @click="cancel('Cancelled at the last moment. Nothing was changed.')">
        Cancel, keep {{ running }}
      </button>
      <button type="button" class="btn-danger" :disabled="switching" @click="confirmSwitch">
        {{ switching ? 'Starting…' : `Confirm, switch to ${target.branch}` }}
      </button>
    </div>
  </ModalDialog>
</template>

<style scoped>
/* The overlay and card are ModalDialog's */
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.change { font-size: 14px; }
.tone-warn { color: #b45309; }
.accept { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 16px; }
.accept input { width: auto; margin-top: 2px; }
.dialog button:disabled { opacity: 0.5; cursor: not-allowed; }
.dialog p { margin-bottom: 10px; line-height: 1.5; }
.warnings { margin: 0 0 16px 18px; padding: 10px 12px 10px 18px; background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--radius); line-height: 1.5; }
.warnings li + li { margin-top: 6px; }
.choices { margin: 0 0 16px 18px; line-height: 1.5; }
.choices li + li { margin-top: 6px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
</style>
