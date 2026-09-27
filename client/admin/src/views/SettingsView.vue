<script setup>
// client/admin/src/views/SettingsView.vue — the Settings page (/admin/settings)
//
// One card per area, in this order: Display, MAC filtering, Logo, Change password (#password),
// Software updates. The settings the first two show are loaded once here (GET /settings); the
// other cards load what they need themselves.
//
// Used by: router/index.js
// Uses: useApi, the cards in components/settings and components/updates
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import DisplaySettingsCard from '../components/settings/DisplaySettingsCard.vue';
import MacFilterCard from '../components/settings/MacFilterCard.vue';
import LogoSettings from '../components/settings/LogoSettings.vue';
import PasswordCard from '../components/settings/PasswordCard.vue';
import SoftwareUpdates from '../components/updates/SoftwareUpdates.vue';

const settings = ref(null);

onMounted(async () => {
  settings.value = await api.get('/settings');
});
</script>

<template>
  <div>
    <h1>Settings</h1>
    <DisplaySettingsCard :settings="settings" />
    <MacFilterCard :settings="settings" />
    <LogoSettings />
    <PasswordCard />
    <SoftwareUpdates />
  </div>
</template>
