import { ref } from 'vue';
import { api } from './useApi.js';

// The logo and whether it's shown, shared by the sidebar and the Settings page, so a change
// in Settings shows in the sidebar straight away
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
