<script setup>
// client/admin/src/components/slideshow/SlideshowSettingsCard.vue — a slideshow's settings on its page
//
// Responsibilities
//   Shows the name, priority, image duration, schedule, background audio and status, with the
//   Publish / Disable and Hide / Unhide buttons; Edit opens the form for the name, priority,
//   duration, schedule and background audio (a published audio show, or none: SYSTEM_DESIGN §18.3).
//   The form starts from the slideshow as it was loaded, and keeps what was typed when it's closed
//   and opened again.
//
// Props: folder, slideshow (the page's copy), defaultSeconds (Settings → Display, for "the default")
// Emits: change(patch), the saved fields, which the page merges into its copy
//
// Used by: views/SlideshowDetailView
// Uses: useApi (PUT /slideshows/:folder, GET /audioshows for the choices), useShowActions, useFlash, ScheduleEditor, StatusBadge,
//   PublishToggle, FlashMessage, CollapsibleCard; LIMITS from @shared (the duration's range, which the server checks)
import { ref, computed, onMounted } from 'vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import { LIMITS } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { useFlash } from '../../composables/useFlash.js';
import { useShowActions } from '../../composables/useShowActions.js';
import ScheduleEditor from './ScheduleEditor.vue';
import StatusBadge from '../ui/StatusBadge.vue';
import PublishToggle from '../ui/PublishToggle.vue';
import FlashMessage from '../ui/FlashMessage.vue';

const props = defineProps({
  folder: { type: String, required: true },
  slideshow: { type: Object, required: true },
  defaultSeconds: { type: Number, required: true },
});
const emit = defineEmits(['change']);

const published = computed(() => props.slideshow.enabled !== false);

// Background audio: the audio shows, for the choices and the chosen one's name
const audioShows = ref([]);
onMounted(async () => {
  try { audioShows.value = await api.get('/audioshows'); } catch { /* the choice just shows None */ }
});
const chosenAudio = computed(() => audioShows.value.find((a) => a.folder === props.slideshow.audioShow) ?? null);
// The published ones, and the current choice even if it has since been unpublished
const audioChoices = computed(() => audioShows.value.filter((a) => a.enabled === true || a.folder === props.slideshow.audioShow));

// Publish / disable, and hide / unhide (only while unpublished; the slideshow is kept exactly as it is)
const { toggling, hiding, setEnabled, setHidden } = useShowActions();

async function togglePublished() {
  const updated = await setEnabled(props.folder, !published.value);
  if (updated) emit('change', { enabled: updated.enabled });
}
async function toggleHidden() {
  const updated = await setHidden(props.folder, !props.slideshow.hidden);
  if (updated) emit('change', { hidden: updated.hidden === true });
}

// The edit form
const editing = ref(false);
const editName = ref(props.slideshow.name);
const editPrio = ref(props.slideshow.priority);
const editSched = ref(props.slideshow.schedule ? JSON.parse(JSON.stringify(props.slideshow.schedule)) : { type: 'always' });
const editOwnDuration = ref(props.slideshow.slideDurationSeconds != null);   // false: the default from Settings
const editSeconds = ref(props.slideshow.slideDurationSeconds ?? props.defaultSeconds);
const editAudio = ref(props.slideshow.audioShow ?? '');   // '': none
const saving = ref(false);
const saveMsg = useFlash();

async function save() {
  saveMsg.clear();
  saving.value = true;
  try {
    const updated = await api.put(`/slideshows/${props.folder}`, {
      name:     editName.value.trim(),
      priority: Number(editPrio.value),
      schedule: editSched.value,
      slideDurationSeconds: editOwnDuration.value ? Number(editSeconds.value) : null,
      audioShow: editAudio.value || null,
    });
    // None is stored as no audioShow at all: say so, or the page's copy would keep the old one
    emit('change', { ...updated, audioShow: updated.audioShow ?? null });
    editing.value = false;
    saveMsg.ok('Saved.', 2000);
  } catch (e) {
    saveMsg.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <CollapsibleCard title="Settings" name="slideshow-settings">
    <template #actions>
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="editing = !editing">
        {{ editing ? 'Cancel' : 'Edit' }}
      </button>
    </template>

    <div v-if="!editing" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;font-size:13px;align-items:start">
      <div><span style="color:var(--text-muted)">Name</span><br>{{ slideshow.name }}</div>
      <div><span style="color:var(--text-muted)">Priority</span><br>{{ slideshow.priority }}</div>
      <div><span style="color:var(--text-muted)">Image duration</span><br>
        <template v-if="slideshow.slideDurationSeconds != null">{{ slideshow.slideDurationSeconds }} s (this slideshow)</template>
        <template v-else>{{ defaultSeconds }} s (the default)</template>
      </div>
      <div><span style="color:var(--text-muted)">Schedule</span><br>
        {{ slideshow.schedule?.type === 'always' ? 'Always active' : `Timed (${slideshow.schedule.startTime}–${slideshow.schedule.endTime})` }}
      </div>
      <div><span style="color:var(--text-muted)">Background audio</span><br>
        <template v-if="!slideshow.audioShow">None</template>
        <template v-else-if="chosenAudio">{{ chosenAudio.name }}<span v-if="chosenAudio.enabled !== true" style="color:var(--text-muted)"> (not published: silent until it is)</span></template>
        <template v-else>…</template>
      </div>
      <div>
        <span style="color:var(--text-muted)">Status</span><br>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
          <StatusBadge :published="published" />
          <PublishToggle small :published="published" :busy="!!toggling" @click="togglePublished" />
          <button
            v-if="slideshow.enabled === false"
            class="btn-ghost"
            style="font-size:11px;padding:3px 10px"
            :disabled="!!hiding"
            :title="slideshow.hidden ? 'Show it in the slideshow list again' : 'Hide it from the slideshow list, keeping it exactly as it is'"
            @click="toggleHidden"
          >{{ slideshow.hidden ? 'Unhide' : 'Hide' }}</button>
        </div>
      </div>
    </div>

    <form v-else @submit.prevent="save">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <div class="field">
          <label>Name</label>
          <input v-model="editName" type="text" required />
        </div>
        <div class="field">
          <label>Priority (lower = higher priority)</label>
          <input v-model.number="editPrio" type="number" min="1" max="99" />
        </div>
      </div>
      <div class="field">
        <label>Image duration</label>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;font-size:13px">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;color:var(--text);margin:0">
            <input v-model="editOwnDuration" type="radio" :value="false" style="width:auto" />
            Use the default ({{ defaultSeconds }} s, set in Settings)
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;color:var(--text);margin:0">
            <input v-model="editOwnDuration" type="radio" :value="true" style="width:auto" />
            Use its own:
            <input v-model.number="editSeconds" type="number" :min="LIMITS.slideSeconds.min" :max="LIMITS.slideSeconds.max" :disabled="!editOwnDuration" style="width:90px" /> seconds
          </label>
        </div>
        <p style="color:var(--text-muted);font-size:12px;margin-top:4px">How long each image shows. Videos always play to the end.</p>
      </div>
      <ScheduleEditor v-model="editSched" />
      <div class="field">
        <label for="slideshow-audio">Background audio</label>
        <select id="slideshow-audio" v-model="editAudio">
          <option value="">None</option>
          <option v-for="a in audioChoices" :key="a.folder" :value="a.folder">{{ a.name }}{{ a.enabled === true ? '' : ' (not published)' }}</option>
        </select>
        <p style="color:var(--text-muted);font-size:12px;margin-top:4px">
          Plays on every screen while this slideshow is on. Only published audio shows can be chosen (Audio in the menu).
        </p>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        <FlashMessage :flash="saveMsg" />
      </div>
    </form>
  </CollapsibleCard>
</template>
