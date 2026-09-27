// client/admin/src/composables/useBranding.js — the logo, shared by the sidebar and the Settings page
//
// A change in Settings shows in the sidebar straight away.
// Provides: useBranding() → { logo ({ enabled, custom, url, maxSize }, or null), refreshLogo() }
// Used by: NavBar, settings/LogoSettings
// Uses: useApi (GET /settings/logo)
import { ref } from 'vue';
import { api } from './useApi.js';

const logo = ref(null);   // { enabled, custom, url, maxSize }

async function refreshLogo() {
  try {
    logo.value = await api.get('/settings/logo');
  } catch {
    // The sidebar works without it
  }
  return logo.value;
}

export function useBranding() {
  return { logo, refreshLogo };
}
