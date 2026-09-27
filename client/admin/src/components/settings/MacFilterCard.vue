<script setup>
// client/admin/src/components/settings/MacFilterCard.vue — Settings → MAC filtering
//
// Responsibilities
//   The on/off switch and the list of approved devices (add, remove; "localhost", this Pi itself,
//   can't be removed). Switching it on first shows MacFilterWarning, since a device that isn't on
//   the list loses access; nothing changes on the server until Save (PUT /settings { macFiltering }).
//
// Props: settings, from GET /settings (null until the page has loaded it)
// Used by: views/SettingsView
// Uses: useApi, useFlash, FlashMessage, MacFilterWarning, CollapsibleCard
import { ref, watch } from 'vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';
import MacFilterWarning from './MacFilterWarning.vue';

const props = defineProps({ settings: { type: Object, default: null } });

const macEnabled = ref(false);
const macWarning = ref(false);   // the pop-up shown when MAC filtering is switched on
const approved   = ref([]);
const msg        = useFlash();
const saving     = ref(false);
const newMac     = ref('');
const newLabel   = ref('');

watch(() => props.settings, (s) => {
  if (!s) return;
  macEnabled.value = s.macFiltering?.enabled ?? false;
  approved.value   = s.macFiltering?.approved ? JSON.parse(JSON.stringify(s.macFiltering.approved)) : [];
}, { immediate: true });

async function save() {
  msg.clear();
  saving.value = true;
  try {
    await api.put('/settings', {
      macFiltering: { enabled: macEnabled.value, approved: approved.value },
    });
    msg.ok('Saved.', 2000);
  } catch (e) {
    msg.error(e.message);
  } finally {
    saving.value = false;
  }
}

// Windows writes MAC addresses with dashes (1A-2B-…); the list uses colons
const normaliseMac = (mac) => mac.trim().toLowerCase().replace(/-/g, ':');

function addMac() {
  const mac = normaliseMac(newMac.value);
  if (!mac) return;
  if (approved.value.find(a => a.mac === mac)) { msg.error('Already in list'); return; }
  approved.value.push({ mac, label: newLabel.value.trim() || mac, addedAt: new Date().toISOString() });
  newMac.value = '';
  newLabel.value = '';
}

// Switching MAC filtering on: warn first
function onMacToggle() {
  if (macEnabled.value) macWarning.value = true;
}
function macWarningConfirmed() {
  macWarning.value = false;
  msg.ok('MAC filtering starts once you click Save.');
}
function macWarningCancelled() {
  macWarning.value = false;
  macEnabled.value = false;
}
function addThisDevice(mac) {
  const normalised = normaliseMac(mac);
  if (!approved.value.find(a => a.mac === normalised)) {
    approved.value.push({ mac: normalised, label: 'This device', addedAt: new Date().toISOString() });
  }
}

function removeMac(mac) {
  approved.value = approved.value.filter(a => a.mac !== mac);
}
</script>

<template>
  <CollapsibleCard title="MAC filtering" name="settings-mac">
    <div class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <input id="mac-toggle" type="checkbox" v-model="macEnabled" style="width:auto" @change="onMacToggle" />
      <label for="mac-toggle" style="margin:0;font-size:13px;font-weight:400;color:var(--text)">
        Enable MAC filter (only approved devices can connect)
      </label>
    </div>

    <div style="margin-bottom:12px">
      <div v-for="a in approved" :key="a.mac"
        style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <code style="font-size:12px;flex:0 0 140px">{{ a.mac }}</code>
        <span style="flex:1;font-size:13px;color:var(--text-muted)">{{ a.label }}</span>
        <button class="btn-ghost" style="padding:3px 8px;font-size:12px" :disabled="a.mac === 'localhost'" @click="removeMac(a.mac)">Remove</button>
      </div>
      <p v-if="!approved.length" style="color:var(--text-muted);font-size:13px">No approved devices.</p>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <input v-model="newMac" type="text" placeholder="aa:bb:cc:dd:ee:ff" style="flex:1 1 160px" />
      <input v-model="newLabel" type="text" placeholder="Label (optional)" style="flex:1 1 160px" />
      <button type="button" class="btn-ghost" @click="addMac">Add</button>
    </div>

    <div style="display:flex;align-items:center;gap:10px">
      <button class="btn-primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
      <FlashMessage :flash="msg" />
    </div>
  </CollapsibleCard>

  <MacFilterWarning
    v-if="macWarning"
    :approved="approved"
    @confirm="macWarningConfirmed"
    @cancel="macWarningCancelled"
    @add="addThisDevice"
  />
</template>
