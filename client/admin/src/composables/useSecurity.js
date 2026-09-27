// client/admin/src/composables/useSecurity.js — whether the admin password is still the default
//
// Shared by the warning banner and the password card, which checks again after a change.
// Provides: useSecurity() → { defaultPassword, refreshSecurity() }
// Used by: DefaultPasswordWarning, settings/PasswordCard
// Uses: useApi (GET /settings/security)
import { ref } from 'vue';
import { api } from './useApi.js';

const defaultPassword = ref(false);

async function refreshSecurity() {
  try {
    defaultPassword.value = (await api.get('/settings/security'))?.defaultPassword === true;
  } catch {
    // No warning if it can't be checked
  }
}

export function useSecurity() {
  return { defaultPassword, refreshSecurity };
}
