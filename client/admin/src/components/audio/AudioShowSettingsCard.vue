<script setup>
// client/admin/src/components/audio/AudioShowSettingsCard.vue — an audio show's settings, on its page
//
// Responsibilities
//   The settings at a glance (order, transition and fade length, volume, published), publishing or
//   unpublishing, and the edit form: name, in order or shuffled, no transition or a crossfade of a
//   chosen length, and the show's volume (PUT /audioshows/:folder; the server checks the same
//   limits, SYSTEM_DESIGN §18.3).
//
// Props: show (the page's copy)
// Emits: change(saved), the saved show, which the page takes as its copy
// Used by: views/AudioShowDetailView
// Uses: useApi, useShowActions, useFlash, FlashMessage, CollapsibleCard, StatusBadge, PublishToggle;
//   AUDIO from @shared (the choices and limits)
import { ref, watch } from 'vue';
import { AUDIO } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import { useShowActions } from '../../composables/useShowActions.js';
import { useFlash } from '../../composables/useFlash.js';
import FlashMessage from '../ui/FlashMessage.vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';
import StatusBadge from '../ui/StatusBadge.vue';
import PublishToggle from '../ui/PublishToggle.vue';

const props = defineProps({ show: { type: Object, required: true } });
const emit = defineEmits(['change']);

const ORDER_LABELS = { 'in-order': 'In order', shuffle: 'Shuffled (a new order each time round)' };
const TRANSITION_LABELS = { none: 'No transition', crossfade: 'Fade / crossfade' };

const editing = ref(false);
const form = ref({});
const saving = ref(false);
const saveMsg = useFlash();
watch(() => props.show, (s) => {
  form.value = { name: s.name, order: s.order, transition: s.transition, fadeSeconds: s.fadeSeconds, volume: s.volume };
}, { immediate: true });

async function save() {
  saving.value = true;
  saveMsg.clear();
  try {
    const saved = await api.put(`/audioshows/${props.show.folder}`, {
      ...form.value,
      fadeSeconds: Number(form.value.fadeSeconds),
      volume: Number(form.value.volume),
    });
    emit('change', saved);
    editing.value = false;
    saveMsg.ok('Saved.');
  } catch (e) {
    saveMsg.error(e.message);
  } finally {
    saving.value = false;
  }
}

const { toggling, setEnabled } = useShowActions('/audioshows');
async function togglePublished() {
  const saved = await setEnabled(props.show.folder, !props.show.enabled);
  if (saved) emit('change', saved);
}
</script>

<template>
  <CollapsibleCard title="Settings" name="audio-settings">
    <template #actions>
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="editing = !editing">
        {{ editing ? 'Cancel' : 'Edit' }}
      </button>
    </template>

    <div v-if="!editing" class="facts">
      <div><span class="muted">Order</span><br>{{ ORDER_LABELS[show.order] ?? show.order }}</div>
      <div>
        <span class="muted">Between tracks</span><br>
        {{ TRANSITION_LABELS[show.transition] ?? show.transition }}<template v-if="show.transition === 'crossfade'">, {{ show.fadeSeconds }} s</template>
      </div>
      <div><span class="muted">Volume</span><br>{{ show.volume }} %</div>
      <div>
        <span class="muted">Status</span><br>
        <span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap">
          <StatusBadge :published="show.enabled" />
          <PublishToggle :published="show.enabled" :busy="toggling === show.folder" small @click="togglePublished" />
        </span>
      </div>
    </div>

    <form v-else class="edit" @submit.prevent="save">
      <div class="field">
        <label for="audio-name">Name</label>
        <input id="audio-name" v-model="form.name" type="text" required />
      </div>
      <div class="field">
        <label for="audio-order">Order</label>
        <select id="audio-order" v-model="form.order">
          <option v-for="o in AUDIO.orders" :key="o" :value="o">{{ ORDER_LABELS[o] ?? o }}</option>
        </select>
      </div>
      <div class="field">
        <label for="audio-transition">Between tracks</label>
        <select id="audio-transition" v-model="form.transition">
          <option v-for="t in AUDIO.transitions" :key="t" :value="t">{{ TRANSITION_LABELS[t] ?? t }}</option>
        </select>
      </div>
      <div v-if="form.transition === 'crossfade'" class="field">
        <label for="audio-fade">Fade length (seconds)</label>
        <input id="audio-fade" v-model.number="form.fadeSeconds" type="number" :min="AUDIO.fadeSeconds.min" :max="AUDIO.fadeSeconds.max" />
      </div>
      <div class="field">
        <label for="audio-volume">Volume: {{ form.volume }} %</label>
        <input id="audio-volume" v-model.number="form.volume" type="range" :min="AUDIO.volume.min" :max="AUDIO.volume.max" step="5" />
      </div>
      <p class="muted" style="font-size:12px;margin:0 0 12px">
        Every track's loudness is evened out when it's uploaded, so the volume applies to them all alike.
      </p>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        <FlashMessage :flash="saveMsg" />
      </div>
    </form>
  </CollapsibleCard>
</template>

<style scoped>
.muted { color: var(--text-muted); }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; font-size: 13px; align-items: start; }
.edit { max-width: 420px; }
.edit select, .edit input[type=number] { width: auto; }
.edit input[type=range] { width: 100%; }
</style>
