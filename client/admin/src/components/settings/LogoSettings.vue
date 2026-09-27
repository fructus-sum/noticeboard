<script setup>
// client/admin/src/components/settings/LogoSettings.vue — Settings → Logo
//
// The logo shown above "No slideshow published" on the displays and above the title in this
// sidebar: show or hide it, upload one, or go back to the default. Uploads are scaled down to fit
// 500 × 500 px on the server: never stretched and never enlarged.
//
// Used by: views/SettingsView
// Uses: useApi (PUT /settings, /settings/logo), useBranding (the logo, shared with the sidebar),
//   useFlash, FlashMessage
import { ref, onMounted } from 'vue';
import { api } from '../../composables/useApi.js';
import { useBranding } from '../../composables/useBranding.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';

const { logo, refreshLogo } = useBranding();
const busy = ref(false);
const msg = useFlash();
const fileInput = ref(null);

async function setEnabled(enabled) {
  busy.value = true;
  msg.clear();
  try {
    await api.put('/settings', { display: { logo: { enabled } } });
    await refreshLogo();
    msg.ok(enabled ? 'The logo is shown.' : 'The logo is hidden.');
  } catch (e) {
    msg.error(e.message);
  } finally {
    busy.value = false;
  }
}

async function upload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  busy.value = true;
  msg.clear();
  const form = new FormData();
  form.append('logo', file);
  try {
    await api.upload('/settings/logo', form);
    await refreshLogo();
    msg.ok('New logo saved.');
  } catch (err) {
    msg.error(err.message);
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function useDefault() {
  busy.value = true;
  msg.clear();
  try {
    await api.del('/settings/logo');
    await refreshLogo();
    msg.ok('Back to the default logo.');
  } catch (e) {
    msg.error(e.message);
  } finally {
    busy.value = false;
  }
}

onMounted(refreshLogo);
</script>

<template>
  <div class="card">
    <h2>Logo</h2>
    <p class="muted">
      Shown above <em>No slideshow published</em> on the displays when nothing is on, and above the
      title in this sidebar. A logo you upload is scaled down to fit {{ logo?.maxSize ?? 500 }} × {{ logo?.maxSize ?? 500 }}
      pixels if it's bigger; it's never stretched or enlarged.
    </p>

    <div v-if="logo" class="logo-row">
      <div class="preview" :class="{ 'preview--off': !logo.enabled }">
        <img :src="logo.url" alt="The current logo" />
      </div>
      <div class="controls">
        <label class="toggle">
          <input type="checkbox" :checked="logo.enabled" :disabled="busy" @change="setEnabled($event.target.checked)" />
          Show the logo
        </label>
        <div class="muted">{{ logo.custom ? 'Your logo' : 'The default logo' }}</div>
        <div class="buttons">
          <label class="btn-primary upload" :class="{ disabled: busy }">
            {{ busy ? 'Working…' : 'Upload a logo…' }}
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" :disabled="busy" @change="upload" />
          </label>
          <button v-if="logo.custom" type="button" class="btn-ghost" :disabled="busy" @click="useDefault">Use the default logo</button>
        </div>
        <FlashMessage :flash="msg" tag="p" />
      </div>
    </div>
    <p v-else class="muted">Loading…</p>
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; margin-bottom: 12px; }
.logo-row { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.preview {
  width: 180px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;   /* as on a display */
  border-radius: var(--radius);
  padding: 10px;
}
.preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.preview--off { opacity: 0.35; }
.controls { flex: 1; min-width: 220px; }
.toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 6px; }
.toggle input { width: auto; }
.buttons { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.upload { display: inline-block; cursor: pointer; font-size: 13px; padding: 7px 14px; border-radius: var(--radius); font-weight: 500; }
.upload input { display: none; }
.upload.disabled { opacity: 0.6; cursor: default; }
</style>
