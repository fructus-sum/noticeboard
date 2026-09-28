<script setup>
// client/admin/src/views/AudioShowsView.vue — every audio show (/admin/audio)
//
// Responsibilities
//   The list with each show's tracks and settings, publishing or unpublishing, creating a show,
//   deleting one, and opening one (SYSTEM_DESIGN §18.3).
//
// Used by: router/index.js
// Uses: useApi (/audioshows), useShowActions, ui/StatusBadge, ui/PublishToggle
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';
import { useShowActions } from '../composables/useShowActions.js';
import StatusBadge from '../components/ui/StatusBadge.vue';
import PublishToggle from '../components/ui/PublishToggle.vue';

const router = useRouter();
const shows = ref([]);
const error = ref('');

const showCreate = ref(false);
const newName = ref('');
const creating = ref(false);
const createError = ref('');
const deleting = ref(null);

const { toggling, setEnabled } = useShowActions('/audioshows');

async function load() {
  try {
    shows.value = await api.get('/audioshows');
  } catch (e) {
    error.value = e.message;
  }
}

async function create() {
  if (!newName.value.trim()) return;
  createError.value = '';
  creating.value = true;
  try {
    const show = await api.post('/audioshows', { name: newName.value.trim() });
    router.push(`/audio/${show.folder}`);
  } catch (e) {
    createError.value = e.message;
  } finally {
    creating.value = false;
  }
}

async function togglePublished(show) {
  const saved = await setEnabled(show.folder, !show.enabled);
  if (saved) shows.value = shows.value.map(s => (s.folder === show.folder ? saved : s));
}

async function remove(show) {
  if (!confirm(`Delete the audio show “${show.name}”? This removes all its tracks permanently.`)) return;
  deleting.value = show.folder;
  try {
    await api.del(`/audioshows/${show.folder}`);
    shows.value = shows.value.filter(s => s.folder !== show.folder);
  } catch (e) {
    alert(e.message);
  } finally {
    deleting.value = null;
  }
}

const summary = (show) => [
  `${show.trackCount} track${show.trackCount === 1 ? '' : 's'}`,
  show.order === 'shuffle' ? 'Shuffled' : 'In order',
  show.transition === 'crossfade' ? `Crossfade ${show.fadeSeconds} s` : 'No transition',
  `Volume ${show.volume} %`,
].join(' · ');

onMounted(load);
</script>

<template>
  <div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <h1 style="margin:0">Audio</h1>
      <button class="btn-primary" @click="showCreate = !showCreate">+ New audio show</button>
    </div>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px">
      An audio show is a list of music or sound tracks, played in order or shuffled, one after another. A published audio
      show can play in the background of a slideshow.
    </p>

    <div v-if="showCreate" class="card" style="margin-bottom:16px">
      <h2>New audio show</h2>
      <form style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap" @submit.prevent="create">
        <div class="field" style="flex:1 1 200px;margin:0">
          <label for="audio-new-name">Name</label>
          <input id="audio-new-name" v-model="newName" type="text" placeholder="e.g. Reception music" autofocus />
        </div>
        <button type="submit" class="btn-primary" :disabled="creating">{{ creating ? 'Creating…' : 'Create' }}</button>
        <button type="button" class="btn-ghost" @click="showCreate = false">Cancel</button>
      </form>
      <p v-if="createError" class="error-msg">{{ createError }}</p>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="!shows.length && !error" style="color:var(--text-muted)">No audio shows yet. Create one above.</p>

    <div v-for="show in shows" :key="show.folder" class="card show-row">
      <div class="show-info" @click="router.push(`/audio/${show.folder}`)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600">{{ show.name }}</span>
          <StatusBadge :published="show.enabled" />
        </div>
        <div style="color:var(--text-muted);font-size:12px;margin-top:2px">{{ summary(show) }}</div>
      </div>
      <div class="show-actions">
        <PublishToggle :published="show.enabled" :busy="toggling === show.folder" @click.stop="togglePublished(show)" />
        <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="router.push(`/audio/${show.folder}`)">Manage</button>
        <button class="btn-danger" style="font-size:12px;padding:5px 10px" :disabled="deleting === show.folder" @click="remove(show)">Delete</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.show-row { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; }
.show-info { flex: 1 1 220px; min-width: 0; cursor: pointer; }
.show-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
