import { ref } from 'vue';
import { api } from './useApi.js';

// Whether the admin password is still the default, shared by the warning banner and the
// Settings page (which checks again after the password is changed)
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
