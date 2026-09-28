// client/admin/src/composables/useRestartState.js — whether the Server needs a restart, shared by the page
//
// Provides
//   useRestartState() → { state, refresh }: state is the last GET /settings/maintenance/restart
//     ({ restartNeeded, port: { running, saved } }, null until loaded), one copy for the whole admin
//     panel, so the port card and the restart box on every page agree; refresh() loads it again
//     (e.g. after the port is saved)
//
// Used by: settings/RestartNotice, settings/ServerPortCard
// Uses: useApi
import { ref } from 'vue';
import { api } from './useApi.js';

const state = ref(null);

async function refresh() {
  try {
    state.value = await api.get('/settings/maintenance/restart');
  } catch {
    // Optional: the pages work without it
  }
}

export function useRestartState() {
  return { state, refresh };
}
