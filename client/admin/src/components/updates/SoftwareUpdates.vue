<script setup>
// client/admin/src/components/updates/SoftwareUpdates.vue — Settings → Software updates
//
// Responsibilities
//   The version this noticeboard runs, how updates went, and switching the GitHub branch updates
//   come from. Nothing changes until the admin has checked the branch, entered the admin password
//   and confirmed a final time; installers/update.sh does the rest. This card puts the parts
//   together and shows the outcome of the last attempt under them.
//
// Used by: views/SettingsView
// Uses: useUpdateInfo (the data and polling), UpdateStatus, BranchSwitcher, SwitchDialogs
import { ref, onMounted } from 'vue';
import { useUpdateInfo } from '../../composables/useUpdateInfo.js';
import UpdateStatus from './UpdateStatus.vue';
import BranchSwitcher from './BranchSwitcher.vue';
import SwitchDialogs from './SwitchDialogs.vue';

const { info, loadError, branches, branchesError, restarting, load, loadBranches, startPolling } = useUpdateInfo();

const message = ref('');           // the outcome of the last attempt, shown under the form
const messageIsError = ref(false);
const switcher = ref(null);
const dialogs = ref(null);

function say(text, isError) {
  message.value = text;
  messageIsError.value = isError;
}

function startSwitch(checked) {
  message.value = '';
  dialogs.value.open(checked);
}

function switched(newInfo) {
  info.value = newInfo;
  switcher.value?.reset();
  message.value = '';
  startPolling();
}

onMounted(() => {
  load();
  loadBranches();
});
</script>

<template>
  <div class="card">
    <h2>Software updates</h2>

    <p v-if="loadError" class="error-msg">{{ loadError }}</p>
    <p v-else-if="!info" class="muted">Loading…</p>
    <p v-else-if="!info.available" class="muted">{{ info.reason }}</p>

    <template v-else>
      <UpdateStatus :info="info" :restarting="restarting" />
      <BranchSwitcher
        v-if="!(info.busy || restarting)"
        ref="switcher"
        :info="info"
        :branches="branches"
        :branches-error="branchesError"
        @checking="message = ''"
        @switch="startSwitch"
      />

      <p v-if="message" :class="messageIsError ? 'error-msg' : 'muted'">{{ message }}</p>
    </template>

    <SwitchDialogs
      ref="dialogs"
      :info="info"
      @cancelled="(note) => say(note, false)"
      @failed="(text) => say(text, true)"
      @switched="switched"
    />
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; }
</style>
