<script setup>
// client/admin/src/components/settings/BrandingSettings.vue — Settings → Branding
//
// Responsibilities
//   The logo shown above "No slideshow published" on the displays and above the title in this
//   sidebar: show or hide it, upload one, or go back to the default. Uploads are scaled down to
//   fit 500 × 500 px on the server: never stretched and never enlarged.
//   The viewer's background colour: it fills the screen around a slide that doesn't fill it, and
//   behind the waiting screen. Chosen with a colour picker or typed as a colour code (kept in
//   step); the logo preview is drawn on it.
//
// Props: settings, from GET /settings (null until the page has loaded it)
// Used by: views/SettingsView
// Uses: useApi (PUT /settings, /settings/logo), useBranding (the logo, shared with the sidebar),
//   useFlash, FlashMessage; DEFAULT_BACKGROUND and isColour from @shared (the server checks the
//   same form)
import { ref, computed, watch, onMounted } from 'vue';
import { DEFAULT_BACKGROUND, isColour } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { useBranding } from '../../composables/useBranding.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';

const props = defineProps({ settings: { type: Object, default: null } });

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

// The background colour: the picker and the code field show the same colour
const colour = ref(DEFAULT_BACKGROUND);        // the colour being chosen (a valid code)
const colourCode = ref(DEFAULT_BACKGROUND);    // what's in the code field, maybe half typed
const savingColour = ref(false);
const colourMsg = useFlash();
const codeValid = computed(() => isColour(colourCode.value.trim()));

watch(() => props.settings, (s) => {
  if (!s) return;
  const saved = s.display?.backgroundColor;
  colour.value = isColour(saved) ? saved.toLowerCase() : DEFAULT_BACKGROUND;
  colourCode.value = colour.value;
}, { immediate: true });

function picked(value) {
  colour.value = value.toLowerCase();
  colourCode.value = colour.value;
}
function typed(value) {
  colourCode.value = value;
  if (isColour(value.trim())) colour.value = value.trim().toLowerCase();
}

async function saveColour() {
  if (!codeValid.value) return;
  colourMsg.clear();
  savingColour.value = true;
  try {
    await api.put('/settings', { display: { backgroundColor: colour.value } });
    colourMsg.ok('Saved. The screens change within a few seconds.', 3000);
  } catch (e) {
    colourMsg.error(e.message);
  } finally {
    savingColour.value = false;
  }
}

onMounted(refreshLogo);
</script>

<template>
  <div class="card">
    <h2>Branding</h2>

    <h3>Logo</h3>
    <p class="muted">
      Shown above <em>No slideshow published</em> on the displays when nothing is on, and above the
      title in this sidebar. A logo you upload is scaled down to fit {{ logo?.maxSize ?? 500 }} × {{ logo?.maxSize ?? 500 }}
      pixels if it's bigger; it's never stretched or enlarged.
    </p>

    <div v-if="logo" class="logo-row">
      <div class="preview" :class="{ 'preview--off': !logo.enabled }" :style="{ background: colour }">
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

    <h3>Background colour</h3>
    <p class="muted">
      Fills the screen around a slide that doesn't fill it (for example, a landscape picture on a
      portrait screen), and behind the logo when nothing is published. Slides are never cut off or
      stretched. Pick a colour, or type its code (e.g. <code>#000000</code> for black).
    </p>
    <form class="colour-row" @submit.prevent="saveColour">
      <input
        type="color"
        class="colour-picker"
        :value="colour"
        aria-label="Background colour"
        @input="picked($event.target.value)"
      />
      <input
        type="text"
        class="colour-code"
        :value="colourCode"
        maxlength="7"
        spellcheck="false"
        autocomplete="off"
        aria-label="Colour code"
        :aria-invalid="!codeValid"
        @input="typed($event.target.value)"
      />
      <button type="submit" class="btn-primary" :disabled="savingColour || !codeValid">{{ savingColour ? 'Saving…' : 'Save' }}</button>
      <FlashMessage :flash="colourMsg" />
    </form>
    <p v-if="!codeValid" class="error-msg">A colour code is # and six digits or letters a–f, e.g. #1a2b3c.</p>
  </div>
</template>

<style scoped>
.muted { color: var(--text-muted); font-size: 13px; margin-bottom: 12px; }
h3 { font-size: 0.95rem; font-weight: 600; margin: 18px 0 6px; }
h3:first-of-type { margin-top: 4px; }
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.logo-row { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.preview {
  width: 180px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;   /* as on a display: the chosen background colour replaces this */
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
.colour-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.colour-picker { width: 48px; height: 36px; padding: 2px; cursor: pointer; }
.colour-code { width: 110px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
