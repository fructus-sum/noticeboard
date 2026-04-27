<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

// --- Display settings ---
const defaultDuration = ref(10);
const displayMsg      = ref('');
const displaySaving   = ref(false);

// --- MAC filtering ---
const macEnabled = ref(false);
const approved   = ref([]);
const macMsg     = ref('');
const macSaving  = ref(false);
const newMac     = ref('');
const newLabel   = ref('');

// --- Password ---
const currentPw  = ref('');
const newPw      = ref('');
const confirmPw  = ref('');
const pwMsg      = ref('');
const pwSaving   = ref(false);

async function load() {
  const s = await api.get('/settings');
  defaultDuration.value = s.display?.defaultSlideDurationSeconds ?? 10;
  macEnabled.value      = s.macFiltering?.enabled ?? false;
  approved.value        = s.macFiltering?.approved ? JSON.parse(JSON.stringify(s.macFiltering.approved)) : [];
}

async function saveDisplay() {
  displayMsg.value = '';
  displaySaving.value = true;
  try {
    await api.put('/settings', { display: { defaultSlideDurationSeconds: Number(defaultDuration.value) } });
    displayMsg.value = 'Saved.';
    setTimeout(() => { displayMsg.value = ''; }, 2000);
  } catch (e) {
    displayMsg.value = e.message;
  } finally {
    displaySaving.value = false;
  }
}

async function saveMac() {
  macMsg.value = '';
  macSaving.value = true;
  try {
    await api.put('/settings', {
      macFiltering: { enabled: macEnabled.value, approved: approved.value },
    });
    macMsg.value = 'Saved.';
    setTimeout(() => { macMsg.value = ''; }, 2000);
  } catch (e) {
    macMsg.value = e.message;
  } finally {
    macSaving.value = false;
  }
}

function addMac() {
  const mac = newMac.value.trim().toLowerCase();
  if (!mac) return;
  if (approved.value.find(a => a.mac === mac)) { macMsg.value = 'Already in list'; return; }
  approved.value.push({ mac, label: newLabel.value.trim() || mac, addedAt: new Date().toISOString() });
  newMac.value = '';
  newLabel.value = '';
}

function removeMac(mac) {
  approved.value = approved.value.filter(a => a.mac !== mac);
}

async function changePassword() {
  pwMsg.value = '';
  if (newPw.value !== confirmPw.value) { pwMsg.value = 'Passwords do not match'; return; }
  if (newPw.value.length < 8) { pwMsg.value = 'Minimum 8 characters'; return; }
  pwSaving.value = true;
  try {
    await api.put('/settings/password', { current: currentPw.value, newPassword: newPw.value });
    pwMsg.value = 'Password changed.';
    currentPw.value = ''; newPw.value = ''; confirmPw.value = '';
    setTimeout(() => { pwMsg.value = ''; }, 3000);
  } catch (e) {
    pwMsg.value = e.message;
  } finally {
    pwSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1>Settings</h1>

    <!-- Display -->
    <div class="card">
      <h2>Display</h2>
      <form @submit.prevent="saveDisplay">
        <div class="field" style="max-width:240px">
          <label>Default image duration (seconds)</label>
          <input v-model.number="defaultDuration" type="number" min="1" max="3600" />
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button type="submit" class="btn-primary" :disabled="displaySaving">{{ displaySaving ? 'Saving…' : 'Save' }}</button>
          <span :class="displayMsg.startsWith('Saved') ? 'success-msg' : 'error-msg'" v-if="displayMsg">{{ displayMsg }}</span>
        </div>
      </form>
    </div>

    <!-- MAC filtering -->
    <div class="card">
      <h2>MAC filtering</h2>
      <div class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <input id="mac-toggle" type="checkbox" v-model="macEnabled" style="width:auto" />
        <label for="mac-toggle" style="margin:0;font-size:13px;font-weight:400;color:var(--text)">
          Enable MAC filter (only approved devices can connect)
        </label>
      </div>

      <div style="margin-bottom:12px">
        <div v-for="a in approved" :key="a.mac"
          style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <code style="font-size:12px;flex:0 0 140px">{{ a.mac }}</code>
          <span style="flex:1;font-size:13px;color:var(--text-muted)">{{ a.label }}</span>
          <button class="btn-ghost" style="padding:3px 8px;font-size:12px" :disabled="a.mac === 'localhost'" @click="removeMac(a.mac)">Remove</button>
        </div>
        <p v-if="!approved.length" style="color:var(--text-muted);font-size:13px">No approved devices.</p>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input v-model="newMac" type="text" placeholder="aa:bb:cc:dd:ee:ff" style="flex:0 0 180px" />
        <input v-model="newLabel" type="text" placeholder="Label (optional)" style="flex:1" />
        <button type="button" class="btn-ghost" @click="addMac">Add</button>
      </div>

      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn-primary" :disabled="macSaving" @click="saveMac">{{ macSaving ? 'Saving…' : 'Save' }}</button>
        <span :class="macMsg.startsWith('Saved') ? 'success-msg' : 'error-msg'" v-if="macMsg">{{ macMsg }}</span>
      </div>
    </div>

    <!-- Change password -->
    <div class="card">
      <h2>Change password</h2>
      <form @submit.prevent="changePassword" style="max-width:320px">
        <div class="field">
          <label>Current password</label>
          <input v-model="currentPw" type="password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label>New password</label>
          <input v-model="newPw" type="password" autocomplete="new-password" minlength="8" required />
        </div>
        <div class="field">
          <label>Confirm new password</label>
          <input v-model="confirmPw" type="password" autocomplete="new-password" required />
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button type="submit" class="btn-primary" :disabled="pwSaving">{{ pwSaving ? 'Saving…' : 'Change password' }}</button>
          <span :class="pwMsg.startsWith('Password changed') ? 'success-msg' : 'error-msg'" v-if="pwMsg">{{ pwMsg }}</span>
        </div>
      </form>
    </div>
  </div>
</template>
