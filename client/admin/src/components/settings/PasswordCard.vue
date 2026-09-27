<script setup>
// client/admin/src/components/settings/PasswordCard.vue — Settings → Change password
//
// The current password, the new one twice (PUT /settings/password). Once changed, the warning
// about the default password goes away. The page links here as /settings#password; while the
// default password is in use the card stays open (it answers that warning).
//
// Used by: views/SettingsView
// Uses: useApi, useSecurity (refreshSecurity, defaultPassword), useFlash, FlashMessage,
//   CollapsibleCard; LIMITS from @shared (the
//   minimum length, which the server checks)
import { ref } from 'vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import { LIMITS } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { useSecurity } from '../../composables/useSecurity.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';

const { refreshSecurity, defaultPassword } = useSecurity();

const currentPw = ref('');
const newPw     = ref('');
const confirmPw = ref('');
const msg       = useFlash();
const saving    = ref(false);

async function changePassword() {
  msg.clear();
  if (newPw.value !== confirmPw.value) { msg.error('Passwords do not match'); return; }
  if (newPw.value.length < LIMITS.passwordMinLength) { msg.error(`Minimum ${LIMITS.passwordMinLength} characters`); return; }
  saving.value = true;
  try {
    await api.put('/settings/password', { current: currentPw.value, newPassword: newPw.value });
    msg.ok('Password changed.', 3000);
    refreshSecurity();   // clears the default-password warning
    currentPw.value = ''; newPw.value = ''; confirmPw.value = '';
  } catch (e) {
    msg.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <CollapsibleCard id="password" title="Change password" name="settings-password" :attention="defaultPassword">
    <form @submit.prevent="changePassword" style="max-width:320px">
      <div class="field">
        <label>Current password</label>
        <input v-model="currentPw" type="password" autocomplete="current-password" required />
      </div>
      <div class="field">
        <label>New password</label>
        <input v-model="newPw" type="password" autocomplete="new-password" :minlength="LIMITS.passwordMinLength" required />
      </div>
      <div class="field">
        <label>Confirm new password</label>
        <input v-model="confirmPw" type="password" autocomplete="new-password" required />
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Change password' }}</button>
        <FlashMessage :flash="msg" />
      </div>
    </form>
  </CollapsibleCard>
</template>
