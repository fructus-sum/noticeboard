<script setup>
// client/admin/src/views/SettingsView.vue — the Settings page (/admin/settings)
//
// One card per area, in this order: Branding (first, the owner, 2026-09-28), Display, MAC filtering,
// Port, Change password (#password), Software updates, Delete content. The settings Branding, Display,
// MAC filtering and Port show are loaded once here (GET /settings); the other cards load what they
// need themselves.
//
// Used by: router/index.js
// Uses: useApi, the cards in components/settings and components/updates
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import DisplaySettingsCard from '../components/settings/DisplaySettingsCard.vue';
import MacFilterCard from '../components/settings/MacFilterCard.vue';
import ServerPortCard from '../components/settings/ServerPortCard.vue';
import BrandingSettings from '../components/settings/BrandingSettings.vue';
import PasswordCard from '../components/settings/PasswordCard.vue';
import SoftwareUpdates from '../components/updates/SoftwareUpdates.vue';
import DeleteContentCard from '../components/settings/DeleteContentCard.vue';

const settings = ref(null);

onMounted(async () => {
  settings.value = await api.get('/settings');
});
</script>

<template>
  <div>
    <h1>Settings</h1>
    <BrandingSettings :settings="settings" />
    <DisplaySettingsCard :settings="settings" />
    <MacFilterCard :settings="settings" />
    <ServerPortCard :settings="settings" />
    <PasswordCard />
    <SoftwareUpdates />
    <DeleteContentCard />
  </div>
</template>
