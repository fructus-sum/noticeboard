<script setup>
// client/admin/src/components/settings/ServerPortCard.vue — Settings → Port
//
// Responsibilities
//   The port the Server listens on (the viewer and this admin panel are both on it). Saving checks
//   it (a whole number from 1024 to 65535, as the server does) and explains what follows: it takes
//   effect when the Server restarts (the restart box at the top of the page does that), and each
//   Client needs its installer run again with the new address (SYSTEM_DESIGN §18.5 item 4).
//
// Props: settings, from GET /settings (null until the page has loaded it)
// Used by: views/SettingsView
// Uses: useApi (PUT /settings { port }), useFlash, useRestartState, FlashMessage, CollapsibleCard;
//   LIMITS from @shared (the port's range)
import { ref, watch } from 'vue';
import { LIMITS } from '@shared/index.js';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import FlashMessage from '../ui/FlashMessage.vue';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import { useRestartState } from '../../composables/useRestartState.js';

const props = defineProps({ settings: { type: Object, default: null } });
const port = ref(LIMITS.port.default);
const saving = ref(false);
const msg = useFlash();
const { refresh } = useRestartState();

watch(() => props.settings, (s) => {
  if (s) port.value = s.port || LIMITS.port.default;
}, { immediate: true });

async function save() {
  msg.clear();
  saving.value = true;
  try {
    await api.put('/settings', { port: Number(port.value) });
    await refresh();
    msg.ok('Saved. It takes effect when the Server restarts: see the box at the top of the page.', 6000);
  } catch (e) {
    msg.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <CollapsibleCard title="Port" name="server-port">
    <form @submit.prevent="save">
      <div class="field">
        <label for="server-port">The port the Server listens on</label>
        <input id="server-port" v-model.number="port" type="number" :min="LIMITS.port.min" :max="LIMITS.port.max" required style="width:120px" />
      </div>
      <p style="color:var(--text-muted);font-size:12px;margin:-4px 0 12px">
        The viewer and this admin panel are both on it ({{ LIMITS.port.default }} unless changed). A new port takes effect
        when the Server restarts. After that, run the installer again on each Client with the Server's new address, and
        allow the new port through any firewall. Change it only if something else needs port {{ LIMITS.port.default }}.
      </p>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        <FlashMessage :flash="msg" />
      </div>
    </form>
  </CollapsibleCard>
</template>
