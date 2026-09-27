// client/admin/src/composables/useUpdateInfo.js — the Software updates card's data
//
// Provides
//   useUpdateInfo() → {
//     info, loadError        GET /settings/updates: the version running, the update settings, the
//                            last check and update, whether an update is running (busy)
//     restarting             requests fail while the server restarts after an update
//     branches, branchesError  GET /settings/updates/branches, for the branch name suggestions
//     load(), loadBranches(), startPolling()
//   }
//   While an update runs (or the server restarts) it reloads every 3 seconds. When a different
//   version is running than the one this page was loaded with, it reloads the page, so the new
//   admin panel shows. Polling stops when the component using it goes away.
//
//   Helpers for the card's parts:
//   short(sha)            the 7-character commit
//   when(iso)             a date and time as the browser writes them
//   runningName(info)     the branch running, or its commit
//   canSwitch(info)       branch switching is set up (the updater's timer or path unit)
//   missingSoftware(checked)  what a checked branch needs that this noticeboard lacks
//
// Used by: components/updates (SoftwareUpdates, UpdateStatus, BranchSwitcher, SwitchDialogs)
import { ref, onUnmounted } from 'vue';
import { api } from './useApi.js';

export const short = (sha) => (sha ? sha.slice(0, 7) : '');
export const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');
export const runningName = (info) => info?.branch || short(info?.commit);
export const canSwitch = (info) => info?.available && (info.autoUpdates || info.instant);
// The branch's system-requirements.json, checked against this noticeboard by the server
export const missingSoftware = (checked) => (checked?.requirements?.listed
  ? checked.requirements.results.filter((r) => !r.ok) : []);

export function useUpdateInfo() {
  const info = ref(null);
  const loadError = ref('');
  const branches = ref([]);
  const branchesError = ref('');
  const restarting = ref(false);
  const loadedCommit = ref('');
  let pollTimer = null;

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

  onUnmounted(stopPolling);

  return { info, loadError, branches, branchesError, restarting, load, loadBranches, startPolling };
}
