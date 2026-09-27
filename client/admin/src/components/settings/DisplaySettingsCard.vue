<script setup>
// client/admin/src/components/settings/DisplaySettingsCard.vue — Settings → Display
//
// The default image duration (for slideshows without their own) and whether the viewer shows the
// location pin. Save sends both (PUT /settings { display }).
//
// Props: settings, from GET /settings (null until the page has loaded it; the defaults show meanwhile)
// Used by: views/SettingsView
// Uses: useApi, useFlash, FlashMessage, CollapsibleCard; LIMITS from @shared (the duration's range, which the server checks)
import { ref, watch } from 'vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import { LIMITS } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';

const props = defineProps({ settings: { type: Object, default: null } });

const defaultDuration = ref(10);
const showDeviceInfo  = ref(true);
const saving          = ref(false);
const msg             = useFlash();

watch(() => props.settings, (s) => {
  if (!s) return;
  defaultDuration.value = s.display?.defaultSlideDurationSeconds ?? 10;
  showDeviceInfo.value  = s.display?.showDeviceInfo !== false;
}, { immediate: true });

async function save() {
  msg.clear();
  saving.value = true;
  try {
    await api.put('/settings', { display: {
      defaultSlideDurationSeconds: Number(defaultDuration.value),
      showDeviceInfo: showDeviceInfo.value,
    } });
    msg.ok('Saved.', 2000);
  } catch (e) {
    msg.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <CollapsibleCard title="Display" name="settings-display">
    <form @submit.prevent="save">
      <div class="field" style="max-width:240px">
        <label>Default image duration (seconds)</label>
        <input v-model.number="defaultDuration" type="number" :min="LIMITS.slideSeconds.min" :max="LIMITS.slideSeconds.max" />
      </div>
      <p style="color:var(--text-muted);font-size:12px;margin:-8px 0 14px">
        Used by every slideshow that doesn't set its own duration. Videos always play to the end.
      </p>
      <div class="field" style="display:flex;align-items:flex-start;gap:8px">
        <input id="show-pin" v-model="showDeviceInfo" type="checkbox" style="width:auto;margin-top:2px" />
        <label for="show-pin" style="margin:0;font-size:13px;font-weight:400;color:var(--text)">
          Show the location pin in the viewer's top-left corner. It shows the Noticeboard server's
          address, so people can find the noticeboard from another device.
        </label>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        <FlashMessage :flash="msg" />
      </div>
    </form>
  </CollapsibleCard>
</template>
