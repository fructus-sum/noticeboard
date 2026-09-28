<script setup>
// client/admin/src/components/audio/AudioEventCard.vue — an audio show's event audio, on its page
//
// Responsibilities
//   While its event is on, every screen plays this show instead of the slideshows' background audio
//   (SYSTEM_DESIGN §18.3). Shows the event and its state (playing now, next, ended; a warning when
//   the show isn't published or has no ready track), Stop for one started by hand, and the form:
//   Off, Start now (until stopped, or until a scheduled event starts), Once (from and to), Repeat
//   (days, start and end). Saving an event that overlaps another show's is refused; the message
//   names it.
//
// Props: show (the page's copy, with event and eventState), readyTracks (how many are ready)
// Emits: change(show), the show as saved
// Used by: views/AudioShowDetailView
// Uses: useApi (PUT /audioshows/:folder/event), useFlash, CollapsibleCard, FlashMessage,
//   ui/WeeklyTimesEditor
import { ref, computed } from 'vue';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import FlashMessage from '../ui/FlashMessage.vue';
import WeeklyTimesEditor from '../ui/WeeklyTimesEditor.vue';

const props = defineProps({
  show: { type: Object, required: true },
  readyTracks: { type: Number, required: true },
});
const emit = defineEmits(['change']);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const localText = (text) => when(text);   // 'YYYY-MM-DDTHH:MM' reads as local time

const event = computed(() => props.show.event ?? null);
const state = computed(() => props.show.eventState?.state ?? null);
const summary = computed(() => {
  const e = event.value;
  if (!e) return 'Off: this show plays only behind the slideshows that choose it.';
  if (e.mode === 'now') return `Started by hand (${when(e.since)}), until stopped or until a scheduled event starts.`;
  if (e.mode === 'once') return `Once: ${localText(e.from)} to ${localText(e.to)}.`;
  return `Every ${e.days.map((d) => DAYS[d]).join(', ')}, ${e.startTime}–${e.endTime}.`;
});
const problem = computed(() => {
  if (!event.value) return '';
  if (props.show.enabled !== true) return "This show isn't published, so its event won't play until it is.";
  if (!props.readyTracks) return 'This show has no ready track yet, so its event has nothing to play.';
  return '';
});

// The form
const editing = ref(false);
const mode = ref(event.value?.mode ?? 'off');
const from = ref(event.value?.from ?? '');
const to = ref(event.value?.to ?? '');
const weekly = ref({ days: event.value?.days ?? [1, 2, 3, 4, 5], startTime: event.value?.startTime ?? '12:00', endTime: event.value?.endTime ?? '13:00' });
const saving = ref(false);
const msg = useFlash();

async function send(body) {
  msg.clear();
  saving.value = true;
  try {
    emit('change', await api.put(`/audioshows/${props.show.folder}/event`, body));
    editing.value = false;
    msg.ok('Saved.', 2000);
  } catch (e) {
    msg.error(e.message);
  } finally {
    saving.value = false;
  }
}

function save() {
  if (mode.value === 'off') return send({ event: null });
  if (mode.value === 'now') return send({ mode: 'now' });
  if (mode.value === 'once') return send({ mode: 'once', from: from.value, to: to.value });
  return send({ mode: 'repeat', days: weekly.value.days ?? [0, 1, 2, 3, 4, 5, 6], startTime: weekly.value.startTime, endTime: weekly.value.endTime });
}
const stop = () => send({ event: null });
</script>

<template>
  <CollapsibleCard title="Event audio" name="audio-event">
    <template #actions>
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="editing = !editing">
        {{ editing ? 'Cancel' : 'Edit' }}
      </button>
    </template>

    <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px">
      While its event is on, every screen plays this show instead of the slideshows' background audio;
      afterwards they carry on with their own, from the next track.
    </p>

    <div class="event-state">
      <span>{{ summary }}</span>
      <span v-if="state === 'playing'" class="badge badge--ready">playing now on every screen</span>
      <span v-else-if="state === 'next'" class="event-next">Next: {{ when(show.eventState.at) }}</span>
      <span v-else-if="state === 'ended'" class="event-next">Ended</span>
      <button v-if="event && event.mode === 'now' && state === 'playing'" class="btn-danger" style="font-size:12px;padding:4px 10px" :disabled="saving" @click="stop">■ Stop</button>
    </div>
    <p v-if="problem" class="event-problem">⚠ {{ problem }}</p>

    <form v-if="editing" class="event-form" @submit.prevent="save">
      <div class="field">
        <label for="audio-event-mode">Event</label>
        <select id="audio-event-mode" v-model="mode">
          <option value="off">Off</option>
          <option value="now">Start now (until stopped)</option>
          <option value="once">Once</option>
          <option value="repeat">Repeat every week</option>
        </select>
      </div>
      <div v-if="mode === 'once'" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <div class="field">
          <label for="audio-event-from">From</label>
          <input id="audio-event-from" v-model="from" type="datetime-local" required />
        </div>
        <div class="field">
          <label for="audio-event-to">To</label>
          <input id="audio-event-to" v-model="to" type="datetime-local" required />
        </div>
      </div>
      <WeeklyTimesEditor v-if="mode === 'repeat'" v-model="weekly" days-label="Days" />
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : mode === 'now' ? 'Start now' : 'Save' }}</button>
      </div>
    </form>
    <FlashMessage :flash="msg" />
  </CollapsibleCard>
</template>

<style scoped>
.event-state { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.event-next { color: var(--text-muted); }
.event-form { margin-top: 12px; }
.event-problem { margin: 10px 0 0; padding: 8px 12px; border-radius: var(--radius); background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25); color: #d97706; font-size: 13px; }
</style>
