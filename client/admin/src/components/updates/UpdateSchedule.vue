<script setup>
// client/admin/src/components/updates/UpdateSchedule.vue — when updates are installed
//
// Responsibilities
//   In the Software updates card (SYSTEM_DESIGN §14 D41):
//   - a waiting version (one update.sh found but hasn't installed yet), with the three choices:
//     Update now (POST /settings/updates/install-now), Set a time (PUT /settings/updates/install-at,
//     default the next 00:00), or waiting for the automatic install, whose time it shows;
//   - the schedule: every 15 minutes, every 2 hours, daily or weekly at a time, or manual
//     (PUT /settings/updates/schedule). Times are the Pi's own clock; a set time is an exact moment.
//   update.sh works out the next install time; after a change the server asks it to check at once.
//
// Props: info (GET /settings/updates)
// Emits: changed(info), the updates info a change returned; started(info), after Update now
//
// Used by: SoftwareUpdates
// Uses: useApi, useFlash, FlashMessage, the helpers in useUpdateInfo
import { ref, computed, watch } from 'vue';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import { short, when } from '../../composables/useUpdateInfo.js';
import FlashMessage from '../ui/FlashMessage.vue';

const props = defineProps({ info: { type: Object, required: true } });
const emit = defineEmits(['changed', 'started']);

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EVERY = [
  { value: '15min', label: 'Every 15 minutes' },
  { value: '2h', label: 'Every 2 hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'manual', label: 'Manual' },
];

const every = ref('15min');
const time = ref('00:00');
const day = ref(0);
watch(() => props.info.schedule, (s) => {
  if (!s) return;
  every.value = s.every;
  time.value = s.time;
  day.value = s.day;
}, { immediate: true });

const saving = ref(false);
const msg = useFlash();
const changed = computed(() => {
  const s = props.info.schedule ?? {};
  return every.value !== s.every
    || (['daily', 'weekly'].includes(every.value) && time.value !== s.time)
    || (every.value === 'weekly' && day.value !== s.day);
});

async function saveSchedule() {
  saving.value = true;
  msg.clear();
  try {
    emit('changed', await api.put('/settings/updates/schedule', { every: every.value, time: time.value, day: day.value }));
    msg.ok('Saved.');
  } catch (e) {
    msg.error(e.message);
  } finally {
    saving.value = false;
  }
}

// The waiting version
const waiting = computed(() => props.info.waiting);
const manual = computed(() => props.info.schedule?.every === 'manual');
const setAt = computed(() => props.info.schedule?.at);

// "Set a time": a date and time in this browser's clock, the next 00:00 by default
const choosing = ref(false);
const atValue = ref('');
function nextMidnight() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
}
function chooseTime() {
  atValue.value = nextMidnight();
  choosing.value = true;
}

const busy = ref(false);
const waitMsg = useFlash();

async function saveAt() {
  busy.value = true;
  waitMsg.clear();
  try {
    emit('changed', await api.put('/settings/updates/install-at', { at: new Date(atValue.value).toISOString() }));
    choosing.value = false;
  } catch (e) {
    waitMsg.error(e.message);
  } finally {
    busy.value = false;
  }
}

async function updateNow() {
  if (!confirm('Install the new version now? The noticeboard restarts once it is built; screens go blank for a few seconds, then reload by themselves.')) return;
  busy.value = true;
  waitMsg.clear();
  try {
    emit('started', await api.post('/settings/updates/install-now'));
  } catch (e) {
    waitMsg.error(e.message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <!-- A new version waiting for its install time -->
  <div v-if="waiting && !info.busy" class="waiting" :class="{ 'waiting--manual': manual }">
    <strong>Update available</strong>
    <p>
      <code>{{ short(waiting.commit) }}</code> {{ waiting.subject }}<template v-if="waiting.date"> ({{ when(waiting.date) }})</template>
    </p>
    <p v-if="setAt">It will be installed at <strong>{{ when(setAt) }}</strong>.</p>
    <p v-else-if="manual">Updates are manual: install it now, or choose when.</p>
    <p v-else-if="waiting.nextInstall">
      Install it now, choose a time, or wait: it's installed automatically at <strong>{{ when(waiting.nextInstall) }}</strong>.
    </p>
    <div class="waiting__actions">
      <button type="button" class="btn-primary" :disabled="busy" @click="updateNow">Update now</button>
      <button v-if="!choosing" type="button" class="btn-ghost" :disabled="busy" @click="chooseTime">{{ setAt ? 'Change the time…' : 'Set a time…' }}</button>
      <template v-else>
        <input v-model="atValue" type="datetime-local" aria-label="Install the update at" />
        <button type="button" class="btn-primary" :disabled="busy || !atValue" @click="saveAt">Save</button>
        <button type="button" class="btn-ghost" :disabled="busy" @click="choosing = false">Cancel</button>
      </template>
    </div>
    <FlashMessage :flash="waitMsg" />
  </div>

  <!-- The schedule -->
  <form class="schedule" @submit.prevent="saveSchedule">
    <h3>Update schedule</h3>
    <div class="schedule__row">
      <div class="field">
        <label for="update-every">Install updates</label>
        <select id="update-every" v-model="every">
          <option v-for="e in EVERY" :key="e.value" :value="e.value">{{ e.label }}</option>
        </select>
      </div>
      <div v-if="every === 'weekly'" class="field">
        <label for="update-day">On</label>
        <select id="update-day" v-model.number="day">
          <option v-for="(d, i) in DAYS" :key="d" :value="i">{{ d }}</option>
        </select>
      </div>
      <div v-if="every === 'daily' || every === 'weekly'" class="field">
        <label for="update-time">At</label>
        <input id="update-time" v-model="time" type="time" required />
      </div>
    </div>
    <p class="muted">
      <template v-if="every === 'manual'">It checks for a new version once a day and tells you here, on every admin page and with the mark on the screens. Nothing is installed until you choose.</template>
      <template v-else-if="every === '15min'">A new version is installed within 15 minutes of being published.</template>
      <template v-else>It checks every 15 minutes and installs a new version at the chosen time; if the noticeboard is off then, as soon as it's back on.</template>
      Times are the noticeboard's own clock.
    </p>
    <div class="schedule__row">
      <button type="submit" class="btn-primary" :disabled="saving || !changed">{{ saving ? 'Saving…' : 'Save' }}</button>
      <FlashMessage :flash="msg" />
    </div>
  </form>
</template>

<style scoped>
code { font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.muted { color: var(--text-muted); font-size: 12px; margin: 0 0 10px; line-height: 1.5; }
.waiting { margin: 12px 0 16px; padding: 12px 14px; border-radius: var(--radius); background: #eff6ff; border: 1px solid #bfdbfe; font-size: 13px; }
.waiting--manual { background: #fffbeb; border-color: #fde68a; }
.waiting p { margin-top: 6px; line-height: 1.5; }
.waiting__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.waiting__actions input { width: auto; }
.schedule { margin: 16px 0; padding-top: 12px; border-top: 1px solid var(--border); }
.schedule h3 { font-size: 14px; margin-bottom: 10px; }
.schedule__row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; }
.schedule__row .field { margin-bottom: 10px; }
.schedule__row select, .schedule__row input { width: auto; }
</style>
