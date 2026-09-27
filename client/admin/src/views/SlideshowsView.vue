<script setup>
// client/admin/src/views/SlideshowsView.vue — the home page: every slideshow (/admin/slideshows)
//
// Responsibilities
//   The updater's notices, this Pi's IP and MAC addresses, the list with publish/disable and
//   hide/unhide (hidden ones behind "Show hidden slideshows"), creating a slideshow, deleting one
//   (never the sample), and opening one.
//
// Used by: router/index.js
// Uses: useApi (/slideshows, /settings/device), useSlideshowActions, ui/StatusBadge,
//   ui/PublishToggle, ui/TagPill
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';
import StatusBadge from '../components/ui/StatusBadge.vue';
import PublishToggle from '../components/ui/PublishToggle.vue';
import TagPill from '../components/ui/TagPill.vue';
import { useSlideshowActions } from '../composables/useSlideshowActions.js';

const router = useRouter();
const slideshows = ref([]);
const error = ref('');

// Create form
const showCreate = ref(false);
const newName = ref('');
const creating = ref(false);
const createError = ref('');

// Delete state
const deletingFolder = ref(null);

// Publish / disable and hide / unhide (the folder being changed disables its buttons)
const { toggling, hiding, setEnabled, setHidden: saveHidden } = useSlideshowActions();

function applyFlags(folder, flags) {
  const idx = slideshows.value.findIndex(s => s.folder === folder);
  if (idx !== -1) slideshows.value[idx] = { ...slideshows.value[idx], ...flags };
}

// Hidden slideshows: kept exactly as they are, just out of the list until shown
const showHidden = ref(false);
const hiddenCount = computed(() => slideshows.value.filter(s => s.hidden).length);
const visible = computed(() => slideshows.value.filter(s => !s.hidden || showHidden.value));

async function setHidden(ss, hidden) {
  const updated = await saveHidden(ss.folder, hidden);
  if (!updated) return;
  applyFlags(ss.folder, { hidden: updated.hidden === true });
  if (!hiddenCount.value) showHidden.value = false;
}

// This Pi's IP and MAC addresses, shown above the list
const device = ref(null);

async function loadDevice() {
  try {
    device.value = await api.get('/settings/device');
  } catch {
    // Optional banner: the page works without it
  }
}

async function toggleEnabled(ss) {
  const updated = await setEnabled(ss.folder, ss.enabled === false);
  if (updated) applyFlags(ss.folder, { enabled: updated.enabled });
}

async function load() {
  try {
    slideshows.value = await api.get('/slideshows');
  } catch (e) {
    error.value = e.message;
  }
}

async function create() {
  if (!newName.value.trim()) return;
  createError.value = '';
  creating.value = true;
  try {
    const ss = await api.post('/slideshows', { name: newName.value.trim() });
    slideshows.value.push({ ...ss, slideCount: 0 });
    newName.value = '';
    showCreate.value = false;
  } catch (e) {
    createError.value = e.message;
  } finally {
    creating.value = false;
  }
}

async function remove(folder) {
  if (!confirm(`Delete "${folder}"? This removes all its slides permanently.`)) return;
  deletingFolder.value = folder;
  try {
    await api.del(`/slideshows/${folder}`);
    slideshows.value = slideshows.value.filter(s => s.folder !== folder);
  } catch (e) {
    alert(e.message);
  } finally {
    deletingFolder.value = null;
  }
}

onMounted(load);
onMounted(loadDevice);
</script>

<template>
  <div>
    <div
      v-if="device?.interfaces?.length"
      class="card"
      style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 20px;padding:10px 16px;font-size:13px"
    >
      <span style="font-weight:600">This noticeboard</span>
      <span v-for="i in device.interfaces" :key="i.name + i.ip" style="color:var(--text-muted)">
        <template v-if="device.interfaces.length > 1">{{ i.name }}: </template>
        IP <code style="color:var(--text)">{{ i.ip }}</code>
        &nbsp;·&nbsp; MAC <code style="color:var(--text)">{{ i.mac }}</code>
      </span>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      <h1 style="margin:0">Slideshows</h1>
      <button class="btn-primary" @click="showCreate = !showCreate">+ New slideshow</button>
    </div>

    <div v-if="showCreate" class="card" style="margin-bottom:16px">
      <h2>New slideshow</h2>
      <form @submit.prevent="create" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="flex:1 1 200px;margin:0">
          <label for="ss-name">Name</label>
          <input id="ss-name" v-model="newName" type="text" placeholder="e.g. Main notices" autofocus />
        </div>
        <button type="submit" class="btn-primary" :disabled="creating">
          {{ creating ? 'Creating…' : 'Create' }}
        </button>
        <button type="button" class="btn-ghost" @click="showCreate = false">Cancel</button>
      </form>
      <p v-if="createError" class="error-msg">{{ createError }}</p>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>

    <p v-if="!slideshows.length && !error" style="color:var(--text-muted)">
      No slideshows yet. Create one above.
    </p>
    <p v-else-if="!visible.length && !error" style="color:var(--text-muted)">
      Every slideshow is hidden. Use "Show hidden slideshows" below to see them.
    </p>

    <div v-for="ss in visible" :key="ss.folder" class="card ss-row" :class="{ 'card--hidden': ss.hidden }">
      <div class="ss-info" @click="router.push(`/slideshows/${ss.folder}`)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600">{{ ss.name }}</span>
          <StatusBadge :published="ss.enabled !== false" />
          <TagPill v-if="ss.hidden">Hidden</TagPill>
          <TagPill v-if="ss.sample" title="Shows what the noticeboard can do. It's updated with new examples when the software is updated.">Sample</TagPill>
        </div>
        <div style="color:var(--text-muted);font-size:12px;margin-top:2px">
          {{ ss.slideCount }} slide{{ ss.slideCount !== 1 ? 's' : '' }} &nbsp;·&nbsp;
          Priority {{ ss.priority }} &nbsp;·&nbsp;
          {{ ss.schedule?.type === 'always' ? 'Always active' : 'Scheduled' }}
        </div>
      </div>

      <!-- Buttons wrap onto another line on a narrow screen, making the card taller -->
      <div class="ss-actions">
      <!-- Publish / Disable toggle (a hidden slideshow is unhidden first) -->
      <PublishToggle
        v-if="!ss.hidden"
        :published="ss.enabled !== false"
        :busy="toggling === ss.folder"
        @click.stop="toggleEnabled(ss)"
      />

      <button
        class="btn-ghost"
        style="font-size:12px;padding:5px 10px"
        @click="router.push(`/slideshows/${ss.folder}`)"
      >Manage</button>
      <button
        v-if="ss.hidden"
        class="btn-ghost"
        style="font-size:12px;padding:5px 10px"
        :disabled="hiding === ss.folder"
        @click="setHidden(ss, false)"
      >Unhide</button>
      <button
        v-else
        class="btn-ghost"
        style="font-size:12px;padding:5px 10px"
        :disabled="hiding === ss.folder || ss.enabled !== false"
        :title="ss.enabled !== false ? 'Only unpublished slideshows can be hidden: disable it first' : 'Hide it from this list, keeping it exactly as it is'"
        @click="setHidden(ss, true)"
      >Hide</button>
      <button
        class="btn-danger"
        style="font-size:12px;padding:5px 10px"
        :disabled="deletingFolder === ss.folder || ss.sample"
        :title="ss.sample ? 'The sample slideshow can’t be deleted. You can hide it instead.' : ''"
        @click="remove(ss.folder)"
      >Delete</button>
      </div>
    </div>

    <button v-if="hiddenCount" class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="showHidden = !showHidden">
      {{ showHidden ? 'Hide hidden slideshows' : `Show hidden slideshows (${hiddenCount})` }}
    </button>
  </div>
</template>

<style scoped>
.card--hidden { opacity: 0.7; border-style: dashed; }
.ss-row { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; }
.ss-info { flex: 1 1 220px; min-width: 0; cursor: pointer; }
.ss-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
