<script setup>
// client/admin/src/components/settings/DisplaySettingsCard.vue — Settings → Display
//
// The default image duration (for slideshows without their own), whether the viewer shows the
// location pin, and the format new videos are converted to: H.265 (the default, smaller files) or
// H.264 (plays everywhere), each explained, with a warning while H.265 is chosen that some screens
// and browsers can't play it (SYSTEM_DESIGN §18.5 item 12). Save sends all three (PUT /settings { display }).
// A warning when videos already uploaded aren't in the saved format (GET /settings/videos/formats).
// Below: "Convert existing videos" to the saved format (POST /settings/videos/convert), after a
// warning that it takes time and slows the Server, with its progress while it runs (polled every 3 s).
//
// Props: settings, from GET /settings (null until the page has loaded it; the defaults show meanwhile)
// Used by: views/SettingsView
// Uses: useApi, useFlash, FlashMessage, CollapsibleCard; LIMITS, VIDEO_FORMATS and DEFAULT_VIDEO_FORMAT
//   from @shared (the duration's range and the video formats, which the server checks)
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import { LIMITS, VIDEO_FORMATS, DEFAULT_VIDEO_FORMAT } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';

const props = defineProps({ settings: { type: Object, default: null } });

const defaultDuration = ref(10);
const showDeviceInfo  = ref(true);
const videoFormat     = ref(DEFAULT_VIDEO_FORMAT);
const savedFormat     = ref(DEFAULT_VIDEO_FORMAT);   // what new uploads (and a conversion) use now
const FORMAT_LABELS   = { h265: 'H.265 (HEVC): smaller files', h264: 'H.264: plays everywhere' };
const FORMAT_NAMES    = { h265: 'H.265', h264: 'H.264' };
const saving          = ref(false);
const msg             = useFlash();

watch(() => props.settings, (s) => {
  if (!s) return;
  defaultDuration.value = s.display?.defaultSlideDurationSeconds ?? 10;
  showDeviceInfo.value  = s.display?.showDeviceInfo !== false;
  videoFormat.value     = VIDEO_FORMATS.includes(s.display?.videoFormat) ? s.display.videoFormat : DEFAULT_VIDEO_FORMAT;
  savedFormat.value     = videoFormat.value;
}, { immediate: true });

async function save() {
  msg.clear();
  saving.value = true;
  try {
    await api.put('/settings', { display: {
      defaultSlideDurationSeconds: Number(defaultDuration.value),
      showDeviceInfo: showDeviceInfo.value,
      videoFormat: videoFormat.value,
    } });
    savedFormat.value = videoFormat.value;
    msg.ok('Saved.', 2000);
    loadFormats();
  } catch (e) {
    msg.error(e.message);
  } finally {
    saving.value = false;
  }
}

// Converting the videos already uploaded
const conversion = ref(null);   // GET /settings/videos/convert
const convertMsg = useFlash();
const unsaved = computed(() => videoFormat.value !== savedFormat.value);
let pollTimer = null;

// The videos already uploaded that aren't in the saved format: a screen that can't play them
// shows nothing for their length, so the card says so (SYSTEM_DESIGN §18.5 item 12)
const formats = ref(null);   // GET /settings/videos/formats: { format, total, other }
async function loadFormats() {
  try {
    formats.value = await api.get('/settings/videos/formats');
  } catch {
    // Optional: the card works without it
  }
}

async function loadConversion() {
  const wasRunning = conversion.value?.running;
  try {
    conversion.value = await api.get('/settings/videos/convert');
  } catch {
    // Optional: the card works without it
  }
  clearTimeout(pollTimer);
  if (conversion.value?.running) pollTimer = setTimeout(loadConversion, 3000);
  else if (wasRunning) loadFormats();
}

async function convertExisting() {
  const name = FORMAT_NAMES[savedFormat.value];
  if (!confirm(`Convert every video already uploaded to ${name}?\n\n`
    + 'This takes a long time: on a Raspberry Pi, several minutes for each minute of video, one video after another. '
    + 'Meanwhile the Server works hard: the screens, uploads and this admin panel may be slower. '
    + 'Screens keep showing each video as it is until its new version is ready.')) return;
  convertMsg.clear();
  try {
    conversion.value = await api.post('/settings/videos/convert');
    if (!conversion.value.total) convertMsg.ok('There are no videos to convert.', 4000);
    loadConversion();
  } catch (e) {
    convertMsg.error(e.message);
  }
}

onMounted(() => { loadConversion(); loadFormats(); });
onUnmounted(() => clearTimeout(pollTimer));
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

      <div class="field" style="max-width:320px">
        <label for="video-format">Video format for new uploads</label>
        <select id="video-format" v-model="videoFormat">
          <option v-for="f in VIDEO_FORMATS" :key="f" :value="f">{{ FORMAT_LABELS[f] ?? f }}</option>
        </select>
      </div>
      <div class="format-help">
        <p>
          Every uploaded video is converted before it's shown, so it plays the same way on every screen. The format
          decides the balance between file size and how widely it plays:
        </p>
        <ul>
          <li>
            <strong>H.265 (HEVC)</strong>: about half the file size of H.264 for the same picture, so more videos fit
            on the Server and the screens download them faster. Converting takes longer (a few times as long as H.264 on a
            Raspberry Pi), and only screens whose browser can decode H.265 can play it.
          </li>
          <li>
            <strong>H.264</strong>: plays on every screen and in every browser, and converts faster; the files are
            about twice as large.
          </li>
        </ul>
      </div>
      <div v-if="videoFormat === 'h265'" class="format-warning" role="note">
        <strong>H.265 may not play everywhere.</strong> A screen can only show an H.265 video if its browser can
        decode it: on a Raspberry Pi 4 or 5 that depends on Chromium using its hardware video decoder (a Raspberry Pi 3 has none, so choose H.264 there), and on a PC on
        its graphics card. A screen that can't play a video shows nothing for the video's length, then the slideshow
        carries on as usual. Some browsers (e.g. Firefox) can't show H.265 in the preview here either. If a video
        doesn't show on a screen, choose H.264, save, and convert the existing videos below.
      </div>
      <p style="color:var(--text-muted);font-size:12px;margin:-4px 0 14px">
        Saving changes only the videos uploaded from now on; the existing ones keep their format until you convert them.
      </p>
      <div style="display:flex;align-items:center;gap:10px">
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        <FlashMessage :flash="msg" />
      </div>
    </form>

    <section class="convert">
      <h3>Existing videos</h3>
      <p>
        Convert the videos already uploaded to <strong>{{ FORMAT_NAMES[savedFormat] }}</strong>, the saved format.
        Videos already in that format are left as they are. Each video shows <em>processing</em> in its slideshow while
        it's its turn, then <em>ready</em> again; the screens keep showing it as it is until the new version is ready.
      </p>
      <div v-if="formats?.other && !conversion?.running" class="format-warning mismatch-warning" role="alert">
        <strong>{{ formats.other }} of the {{ formats.total }} videos uploaded {{ formats.other === 1 ? "isn't" : "aren't" }} {{ FORMAT_NAMES[formats.format] }}</strong>,
        the format selected. A screen that can't play {{ formats.other === 1 ? 'it' : 'them' }} shows nothing for the
        video's length, then carries on. <strong>Convert existing videos</strong> below makes them all
        {{ FORMAT_NAMES[formats.format] }}.
      </div>
      <div class="format-warning" role="note">
        <strong>This takes a long time and slows the Server down.</strong> Videos are converted one after another, and on
        a Raspberry Pi each minute of video takes several minutes. Meanwhile the screens, uploads and this admin panel
        may be slower. It carries on if you leave this page; an update waits for it to finish.
      </div>
      <div v-if="conversion?.running" class="convert__progress" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <span>
          Converting to {{ FORMAT_NAMES[conversion.format] }}: {{ conversion.done }} of {{ conversion.total }} done<template v-if="conversion.current">, now “{{ conversion.current }}”</template>…
        </span>
      </div>
      <p v-else-if="conversion?.finishedAt && conversion.total" class="convert__done">
        Last conversion to {{ FORMAT_NAMES[conversion.format] }}: {{ conversion.converted }} converted,
        {{ conversion.skipped }} already {{ FORMAT_NAMES[conversion.format] }}<template v-if="conversion.failed">, {{ conversion.failed }} couldn't be converted (they keep their old version)</template>.
      </p>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn-ghost" :disabled="conversion?.running || unsaved" @click="convertExisting">
          Convert existing videos to {{ FORMAT_NAMES[savedFormat] }}…
        </button>
        <span v-if="unsaved" class="muted-note">Save the new format first.</span>
        <FlashMessage :flash="convertMsg" />
      </div>
    </section>
  </CollapsibleCard>
</template>

<style scoped>
.format-help { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: -6px 0 12px; }
.format-help ul { margin: 6px 0 0 18px; }
.format-help li + li { margin-top: 4px; }
.format-warning {
  margin: 0 0 14px;
  padding: 10px 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius);
  color: #92400e;
  font-size: 12px;
  line-height: 1.5;
}
.convert { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); font-size: 13px; }
.convert h3 { font-size: 14px; margin-bottom: 8px; }
.convert > p { color: var(--text-muted); font-size: 12px; line-height: 1.5; margin-bottom: 10px; }
.convert__progress { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.convert__done { font-size: 12px; margin-bottom: 10px; }
.muted-note { color: var(--text-muted); font-size: 12px; }
.spinner {
  width: 16px;
  height: 16px;
  flex: none;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
