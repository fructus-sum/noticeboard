<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { api } from '../composables/useApi.js';

// Software updates: the version this noticeboard runs, how updates went, and switching the
// GitHub branch updates come from. Nothing changes until the admin has checked the branch,
// entered the admin password and confirmed a final time; installers/update.sh does the rest.

const info = ref(null);
const loadError = ref('');
const branches = ref([]);
const branchesError = ref('');

const branchInput = ref('');
const checking = ref(false);
const checked = ref(null);        // the verified branch: { branch, commit, subject, date, current }
const checkError = ref('');
const message = ref('');           // the outcome of the last attempt, shown under the form
const messageIsError = ref(false);

// The two confirmations
const step = ref('');              // '' | 'software' | 'password' | 'final'
const acceptMissing = ref(false);  // the extra confirmation when software the branch needs is missing
const password = ref('');
const verifying = ref(false);
const token = ref('');
const switching = ref(false);
const passwordInput = ref(null);
const cancelFinal = ref(null);

// Following a switch while it runs
const restarting = ref(false);
const loadedCommit = ref('');
let pollTimer = null;

const short = (sha) => (sha ? sha.slice(0, 7) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

const canSwitch = computed(() => info.value?.available && (info.value.autoUpdates || info.value.instant));
// The branch's system-requirements.json, checked against this noticeboard by the server
const missingSoftware = computed(() => (checked.value?.requirements?.listed
  ? checked.value.requirements.results.filter((r) => !r.ok) : []));

const isCurrent = computed(() => checked.value
  && checked.value.branch === info.value?.branch
  && checked.value.branch === info.value?.configuredBranch);
const running = computed(() => info.value?.branch || short(info.value?.commit));

const STATES = {
  requested:     { label: 'Waiting to start', tone: 'info' },
  updating:      { label: 'In progress',      tone: 'info' },
  updated:       { label: 'Done',             tone: 'ok' },
  'rolled-back': { label: 'Rolled back',      tone: 'warn' },
  cancelled:     { label: 'Cancelled',        tone: 'warn' },
  failed:        { label: 'Failed',           tone: 'bad' },
};
const CHECKS = {
  'up-to-date': 'ok', waiting: 'info', skipped: 'warn', offline: 'warn', error: 'bad',
};
const statusView = computed(() => {
  const s = info.value?.status;
  if (!s) return null;
  // Requested or running for over an hour: it never finished (e.g. the Pi lost power)
  if (!info.value.busy && (s.state === 'requested' || s.state === 'updating')) {
    return { label: "Didn't finish", tone: 'bad', note: 'The update log on the Pi may say why: journalctl -u noticeboard-update' };
  }
  return STATES[s.state] ?? { label: s.state, tone: 'info' };
});

async function load() {
  try {
    info.value = await api.get('/settings/updates');
    loadError.value = '';
    restarting.value = false;
    if (!loadedCommit.value) loadedCommit.value = info.value.commit ?? '';
  } catch (e) {
    // While the server restarts after an update, requests fail for a few seconds
    if (pollTimer) restarting.value = true;
    else loadError.value = e.message;
  }
  // A different version is running: load its admin panel
  if (info.value?.commit && loadedCommit.value && info.value.commit !== loadedCommit.value && !info.value.busy) {
    window.location.reload();
    return;
  }
  if (info.value?.busy || restarting.value) startPolling();
  else stopPolling();
}

async function loadBranches() {
  try {
    branches.value = (await api.get('/settings/updates/branches')).branches;
    branchesError.value = '';
  } catch (e) {
    branchesError.value = `${e.message} You can still type a branch name.`;
  }
}

function startPolling() {
  if (!pollTimer) pollTimer = setInterval(load, 3000);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function branchEdited() {
  checked.value = null;
  checkError.value = '';
}

async function checkBranch() {
  const branch = branchInput.value.trim();
  if (!branch) return;
  checking.value = true;
  checked.value = null;
  checkError.value = '';
  message.value = '';
  try {
    checked.value = await api.post('/settings/updates/check', { branch });
  } catch (e) {
    checkError.value = e.message;
  } finally {
    checking.value = false;
  }
}

// First confirmation: software the branch needs that this noticeboard lacks, if any; then the
// warnings and the admin password
async function openPassword() {
  message.value = '';
  password.value = '';
  if (missingSoftware.value.length && step.value !== 'software') {
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
  if (note) {
    message.value = note;
    messageIsError.value = false;
  }
}

async function verifyPassword() {
  if (!password.value) return;
  verifying.value = true;
  try {
    const res = await api.post('/settings/updates/verify-password', { password: password.value, branch: checked.value.branch });
    token.value = res.token;
    password.value = '';
    step.value = 'final';
    await nextTick();
    cancelFinal.value?.focus();   // the safe choice is the default
  } catch (e) {
    // Wrong password (or too many tries): the switch is cancelled, nothing changes
    step.value = '';
    password.value = '';
    message.value = e.message;
    messageIsError.value = true;
  } finally {
    verifying.value = false;
  }
}

// Second and final confirmation: start the switch
async function confirmSwitch() {
  switching.value = true;
  try {
    info.value = await api.post('/settings/updates/switch', {
      branch: checked.value.branch,
      token: token.value,
      acceptMissing: missingSoftware.value.length > 0 && acceptMissing.value,
    });
    step.value = '';
    token.value = '';
    checked.value = null;
    branchInput.value = '';
    message.value = '';
    startPolling();
  } catch (e) {
    step.value = '';
    token.value = '';
    message.value = e.message;
    messageIsError.value = true;
  } finally {
    switching.value = false;
  }
}

function onKey(e) {
  if (e.key === 'Escape' && step.value) cancel('Cancelled. Nothing was changed.');
}

onMounted(() => {
  load();
  loadBranches();
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  stopPolling();
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div class="card">
    <h2>Software updates</h2>

    <p v-if="loadError" class="error-msg">{{ loadError }}</p>
    <p v-else-if="!info" class="muted">Loading…</p>
    <p v-else-if="!info.available" class="muted">{{ info.reason }}</p>

    <template v-else>
      <dl class="facts">
        <dt>Running</dt>
        <dd>
          <strong>{{ running }}</strong> <code>{{ short(info.commit) }}</code>
          <span v-if="canSwitch && info.configuredBranch !== info.branch" class="muted">
            · updates now come from <strong>{{ info.configuredBranch }}</strong>
          </span>
        </dd>

        <dt>Updates</dt>
        <dd>
          <template v-if="info.autoUpdates">Checked every 15 minutes.</template>
          <template v-else-if="info.instant">Only when you switch branch (the 15-minute check is turned off).</template>
          <template v-else>Automatic updates aren't set up on this noticeboard. Run the installer on the Pi to set them up.</template>
          <div v-if="info.lastCheck" class="muted">
            Last check {{ when(info.lastCheck.time) }}:
            <span :class="`tone-${CHECKS[info.lastCheck.result] ?? 'info'}`">{{ info.lastCheck.message }}</span>
          </div>
        </dd>

        <template v-if="info.status">
          <dt>Last update</dt>
          <dd>
            <span class="pill" :class="`pill--${statusView.tone}`">{{ statusView.label }}</span>
            {{ when(info.status.time) }}
            <div>{{ info.status.message }}</div>
            <div v-if="statusView.note" class="muted">{{ statusView.note }}</div>
          </dd>
        </template>
      </dl>

      <!-- A switch or update is running -->
      <div v-if="info.busy || restarting" class="progress">
        <span class="spinner" aria-hidden="true"></span>
        <div>
          <strong>{{ restarting ? 'The noticeboard is restarting…' : info.status?.state === 'requested' ? 'Waiting for the update to start…' : 'Updating…' }}</strong>
          <div class="muted">
            {{ restarting
              ? "This page reconnects by itself. The screens go blank for a few seconds, then reload by themselves."
              : 'You can leave this page; the update carries on. Branch switching is available again once it finishes.' }}
          </div>
        </div>
      </div>

      <!-- Choosing a branch -->
      <div v-else class="branch-form">
        <h3>Branch</h3>
        <p class="muted">
          Updates come from the <strong>{{ info.configuredBranch }}</strong> branch on GitHub. <strong>main</strong> is the
          stable version; other branches hold work in progress. Nothing changes until you've checked the branch and
          confirmed twice.
        </p>
        <form class="row" @submit.prevent="checkBranch">
          <input
            v-model="branchInput"
            list="update-branches"
            type="text"
            placeholder="Branch name, e.g. main"
            autocomplete="off"
            spellcheck="false"
            aria-label="Branch name"
            :disabled="!canSwitch"
            @input="branchEdited"
          />
          <datalist id="update-branches">
            <option v-for="b in branches" :key="b" :value="b" />
          </datalist>
          <button type="submit" class="btn-ghost" :disabled="!canSwitch || checking || !branchInput.trim()">
            {{ checking ? 'Checking…' : 'Check branch' }}
          </button>
        </form>
        <p v-if="branchesError" class="muted">{{ branchesError }}</p>
        <p v-if="checkError" class="error-msg">{{ checkError }}</p>

        <div v-if="checked" class="checked">
          <template v-if="isCurrent">
            <p>This noticeboard already uses <strong>{{ checked.branch }}</strong>.</p>
          </template>
          <template v-else>
            <p class="tone-ok">✓ <strong>{{ checked.branch }}</strong> exists on GitHub and can be used.</p>
            <p class="change">
              <strong>{{ running }}</strong> <code>{{ short(info.commit) }}</code>
              <span aria-label="to"> → </span>
              <strong>{{ checked.branch }}</strong> <code>{{ short(checked.commit) }}</code>
            </p>
            <p class="muted">Latest commit: “{{ checked.subject }}”, {{ when(checked.date) }}</p>

            <div v-if="!checked.requirements?.listed" class="software software--unknown">
              {{ checked.branch }} doesn’t list the software it needs, so this noticeboard can’t be checked against it.
            </div>
            <div v-else-if="!missingSoftware.length" class="software software--ok">
              ✓ This noticeboard has the software {{ checked.branch }} needs:
              <span v-for="(r, i) in checked.requirements.results" :key="r.name">{{ i ? ', ' : ' ' }}{{ r.name }} {{ r.found }}</span>.
            </div>
            <div v-else class="software software--missing">
              <strong>⚠ This noticeboard is missing software {{ checked.branch }} needs.</strong>
              Install it yourself before switching, or the branch may not work:
              <ul>
                <li v-for="r in missingSoftware" :key="r.name">
                  <strong>{{ r.name }}</strong>: needs {{ r.required }}; this noticeboard has {{ r.installed ? r.found : 'none' }}.
                  {{ r.neededFor }} <span class="install">To install: {{ r.install }}</span>
                </li>
              </ul>
            </div>

            <div v-if="checked.installer?.needed" class="software software--missing installer-needed">
              <strong>⚠ After switching, run the installer again on this Pi.</strong>
              {{ checked.branch }} needs something only the installer sets up, which a switch can’t do by itself.
              Until it’s run, these stay as they were:
              <ul>
                <li v-for="c in checked.installer.changes" :key="c">{{ c }}</li>
              </ul>
              The Slideshows page shows the command to run once the switch is done.
            </div>

            <button class="btn-danger" @click="openPassword">Switch to {{ checked.branch }}…</button>
          </template>
        </div>
      </div>

      <p v-if="message" :class="messageIsError ? 'error-msg' : 'muted'">{{ message }}</p>
    </template>

    <!-- Extra confirmation: software the branch needs is missing -->
    <div v-if="step === 'software'" class="overlay" @click.self="cancel('Cancelled. Nothing was changed.')">
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="software-title" @submit.prevent="openPassword">
        <h2 id="software-title">Missing software</h2>
        <p>
          <strong>{{ checked.branch }}</strong> needs software this noticeboard doesn’t have, or has in a version that’s too old.
          Install it yourself before switching: until you do, the branch may not work.
        </p>
        <ul class="warnings">
          <li v-for="r in missingSoftware" :key="r.name">
            <strong>{{ r.name }}</strong> {{ r.required }} (this noticeboard has {{ r.installed ? r.found : 'none' }}).
            {{ r.neededFor }} To install: <code>{{ r.install }}</code>
          </li>
        </ul>
        <label class="accept">
          <input v-model="acceptMissing" type="checkbox" />
          I’ve installed it myself, or I accept that {{ checked.branch }} may not work until I do.
        </label>
        <div class="actions">
          <button type="button" class="btn-ghost" @click="cancel('Cancelled. Nothing was changed.')">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="!acceptMissing">Continue</button>
        </div>
      </form>
    </div>

    <!-- First confirmation: warnings and the admin password -->
    <div v-if="step === 'password'" class="overlay" @click.self="cancel('Cancelled. Nothing was changed.')">
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="switch-title" @submit.prevent="verifyPassword">
        <h2 id="switch-title">Switch to {{ checked.branch }}?</h2>
        <p class="change">
          <strong>{{ running }}</strong> <code>{{ short(info.commit) }}</code> →
          <strong>{{ checked.branch }}</strong> <code>{{ short(checked.commit) }}</code>
        </p>
        <ul class="warnings">
          <li><strong>Experimental.</strong> Branches other than main hold work in progress. They may be unfinished or untested.</li>
          <li><strong>May not work here.</strong> A branch can expect settings, files or system packages this noticeboard doesn't have.</li>
          <li><strong>May be unstable.</strong> Slideshows, screens, the admin panel or updates may misbehave until you switch back.</li>
          <li>
            <strong>Your data.</strong> Slideshows, slides and settings are kept, and the settings are backed up first (in
            data/backups on the Pi). But a branch may change how it stores them, and switching back doesn't undo that.
          </li>
          <li><strong>Future updates</strong> come from {{ checked.branch }} until you switch back.</li>
        </ul>
        <div class="field">
          <label for="switch-password">Admin password</label>
          <input id="switch-password" ref="passwordInput" v-model="password" type="password" autocomplete="current-password" required />
        </div>
        <div class="actions">
          <button type="button" class="btn-ghost" :disabled="verifying" @click="cancel('Cancelled. Nothing was changed.')">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="verifying || !password">{{ verifying ? 'Checking…' : 'Continue' }}</button>
        </div>
      </form>
    </div>

    <!-- Final confirmation -->
    <div v-if="step === 'final'" class="overlay" @click.self="cancel('Cancelled. Nothing was changed.')">
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="final-title" aria-describedby="final-body">
        <h2 id="final-title">Last chance to avoid doing something stupid!</h2>
        <div id="final-body">
          <p>
            Your password checked out, so the only thing between this noticeboard and <strong>{{ checked.branch }}</strong>
            is you and this button.
          </p>
          <p v-if="missingSoftware.length" class="tone-warn">
            Remember: this noticeboard is still missing {{ missingSoftware.map((r) => r.name).join(', ') }}.
          </p>
          <p v-if="checked.installer?.needed" class="tone-warn">
            Afterwards, run the installer again on this Pi: the Slideshows page will show how.
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
            {{ switching ? 'Starting…' : `Confirm, switch to ${checked.branch}` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; }
h3 { font-size: 0.95rem; font-weight: 600; margin: 18px 0 6px; }
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }

.facts { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; font-size: 13px; }
.facts dt { color: var(--text-muted); font-weight: 500; }
.facts dd div { margin-top: 2px; }

.pill { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; margin-right: 6px; }
.pill--ok   { background: #dcfce7; color: #166534; }
.pill--info { background: #dbeafe; color: #1e40af; }
.pill--warn { background: #fef3c7; color: #92400e; }
.pill--bad  { background: #fee2e2; color: #991b1b; }
.tone-ok   { color: var(--success); }
.tone-info { color: var(--text-muted); }
.tone-warn { color: #b45309; }
.tone-bad  { color: var(--danger); }

.progress { display: flex; gap: 12px; align-items: flex-start; margin-top: 16px; padding: 12px; background: #eff6ff; border-radius: var(--radius); font-size: 13px; }
.spinner { flex: none; width: 16px; height: 16px; margin-top: 2px; border: 2px solid #93c5fd; border-top-color: var(--primary); border-radius: 50%; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.branch-form p { margin-bottom: 10px; }
.row { display: flex; gap: 8px; max-width: 480px; margin-bottom: 6px; }
.row input { flex: 1; }
.row button { flex: none; }
.checked { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; }
.checked p { margin-bottom: 8px; }
.change { font-size: 14px; }

.software { margin: 4px 0 10px; padding: 10px 12px; border-radius: var(--radius); font-size: 13px; line-height: 1.5; }
.software ul { margin: 6px 0 0 18px; }
.software li + li { margin-top: 4px; }
.software .install { color: var(--text-muted); }
.software--ok { background: #f0fdf4; color: #166534; }
.software--missing { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
.software--unknown { background: var(--surface-2); color: var(--text-muted); }
.installer-needed ul { margin-bottom: 6px; }
.accept { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 16px; }
.accept input { width: auto; margin-top: 2px; }
.dialog button:disabled { opacity: 0.5; cursor: not-allowed; }

.overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 1000; }
.dialog { background: var(--surface); border-radius: 8px; padding: 22px; width: 100%; max-width: 540px; max-height: calc(100vh - 32px); overflow-y: auto; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3); font-size: 13px; }
.dialog p { margin-bottom: 10px; line-height: 1.5; }
.warnings { margin: 0 0 16px 18px; padding: 10px 12px 10px 18px; background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--radius); line-height: 1.5; }
.warnings li + li { margin-top: 6px; }
.choices { margin: 0 0 16px 18px; line-height: 1.5; }
.choices li + li { margin-top: 6px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
</style>
