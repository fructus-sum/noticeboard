<script setup>
// client/admin/src/components/updates/BranchSwitcher.vue — choosing the branch updates come from
//
// Responsibilities
//   The branch name (with GitHub's branches as suggestions) and "Check branch"
//   (POST /settings/updates/check). The result: the change from what runs now, the branch's latest
//   commit, whether this noticeboard has the software the branch needs, whether the installer must
//   run again afterwards, and the "Switch to …" button. Editing the name drops the result.
//
// Props: info (GET /settings/updates), branches, branchesError
// Emits: checking (a check started), switch(checked), the checked branch the admin wants
// Exposes: reset(), which empties the form once a switch has started
//
// Used by: SoftwareUpdates (which runs the confirmations in SwitchDialogs)
// Uses: useApi, the helpers in useUpdateInfo
import { ref, computed } from 'vue';
import { api } from '../../composables/useApi.js';
import { short, when, runningName, canSwitch, missingSoftware } from '../../composables/useUpdateInfo.js';

const props = defineProps({
  info: { type: Object, required: true },
  branches: { type: Array, required: true },
  branchesError: { type: String, default: '' },
});
const emit = defineEmits(['checking', 'switch']);

const branchInput = ref('');
const checking = ref(false);
const checked = ref(null);        // the verified branch: { branch, commit, subject, date, current, requirements, installer }
const checkError = ref('');

const running = computed(() => runningName(props.info));
const missing = computed(() => missingSoftware(checked.value));
const isCurrent = computed(() => checked.value
  && checked.value.branch === props.info.branch
  && checked.value.branch === props.info.configuredBranch);

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
  emit('checking');
  try {
    checked.value = await api.post('/settings/updates/check', { branch });
  } catch (e) {
    checkError.value = e.message;
  } finally {
    checking.value = false;
  }
}

function reset() {
  checked.value = null;
  branchInput.value = '';
}
defineExpose({ reset });
</script>

<template>
  <div class="branch-form">
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
        :disabled="!canSwitch(info)"
        @input="branchEdited"
      />
      <datalist id="update-branches">
        <option v-for="b in branches" :key="b" :value="b" />
      </datalist>
      <button type="submit" class="btn-ghost" :disabled="!canSwitch(info) || checking || !branchInput.trim()">
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
        <div v-else-if="!missing.length" class="software software--ok">
          ✓ This noticeboard has the software {{ checked.branch }} needs:
          <span v-for="(r, i) in checked.requirements.results" :key="r.name">{{ i ? ', ' : ' ' }}{{ r.name }} {{ r.found }}</span>.
        </div>
        <div v-else class="software software--missing">
          <strong>⚠ This noticeboard is missing software {{ checked.branch }} needs.</strong>
          Install it yourself before switching, or the branch may not work:
          <ul>
            <li v-for="r in missing" :key="r.name">
              <strong>{{ r.name }}</strong>: needs {{ r.required }}; this noticeboard has {{ r.installed ? r.found : 'none' }}.
              {{ r.neededFor }} <span class="install">To install: {{ r.install }}</span>
            </li>
          </ul>
        </div>

        <div v-if="checked.installer?.needed" class="software software--missing installer-needed">
          <strong>⚠ After switching, run the installer again on the Server.</strong>
          {{ checked.branch }} needs something only the installer sets up, which a switch can’t do by itself.
          Until it’s run, these stay as they were:
          <ul>
            <li v-for="c in checked.installer.changes" :key="c">{{ c }}</li>
          </ul>
          Every admin page shows the command to run once the switch is done.
        </div>

        <button class="btn-danger" @click="emit('switch', checked)">Switch to {{ checked.branch }}…</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; }
h3 { font-size: 0.95rem; font-weight: 600; margin: 18px 0 6px; }
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.tone-ok { color: var(--success); }

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
</style>
