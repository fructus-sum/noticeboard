<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';
import UpdateNotice from '../components/UpdateNotice.vue';

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

// Publish / disable toggle
const togglingFolder = ref(null);

// Hidden slideshows: kept exactly as they are, just out of the list until shown
const showHidden = ref(false);
const hiddenCount = computed(() => slideshows.value.filter(s => s.hidden).length);
const visible = computed(() => slideshows.value.filter(s => !s.hidden || showHidden.value));
const hidingFolder = ref(null);

async function setHidden(ss, hidden) {
  hidingFolder.value = ss.folder;
  try {
    const updated = await api.put(`/slideshows/${ss.folder}`, { hidden });
    const idx = slideshows.value.findIndex(s => s.folder === ss.folder);
    if (idx !== -1) slideshows.value[idx] = { ...slideshows.value[idx], hidden: updated.hidden === true };
    if (!hiddenCount.value) showHidden.value = false;
  } catch (e) {
    alert(e.message);
  } finally {
    hidingFolder.value = null;
  }
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

async function toggleEnabled(folder, currentEnabled) {
  togglingFolder.value = folder;
  try {
    const updated = await api.put(`/slideshows/${folder}`, { enabled: !currentEnabled });
    const idx = slideshows.value.findIndex(s => s.folder === folder);
    if (idx !== -1) slideshows.value[idx] = { ...slideshows.value[idx], enabled: updated.enabled };
  } catch (e) {
    alert(e.message);
  } finally {
    togglingFolder.value = null;
  }
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
    <UpdateNotice />

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

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h1 style="margin:0">Slideshows</h1>
      <button class="btn-primary" @click="showCreate = !showCreate">+ New slideshow</button>
    </div>

    <div v-if="showCreate" class="card" style="margin-bottom:16px">
      <h2>New slideshow</h2>
      <form @submit.prevent="create" style="display:flex;gap:8px;align-items:flex-end">
        <div class="field" style="flex:1;margin:0">
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

    <div v-for="ss in visible" :key="ss.folder" class="card" :class="{ 'card--hidden': ss.hidden }" style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;cursor:pointer" @click="router.push(`/slideshows/${ss.folder}`)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:600">{{ ss.name }}</span>
          <span
            :style="{
              fontSize: '11px',
              fontWeight: '600',
              padding: '2px 7px',
              borderRadius: '10px',
              background: ss.enabled !== false ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)',
              color:      ss.enabled !== false ? '#16a34a'              : 'var(--text-muted)',
              border:     ss.enabled !== false ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(148,163,184,0.25)',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
            }"
          >{{ ss.enabled !== false ? 'Published' : 'Disabled' }}</span>
          <span v-if="ss.hidden" class="tag">Hidden</span>
          <span v-if="ss.sample" class="tag" title="Shows what the noticeboard can do. It's updated with new examples when the software is updated.">Sample</span>
        </div>
        <div style="color:var(--text-muted);font-size:12px;margin-top:2px">
          {{ ss.slideCount }} slide{{ ss.slideCount !== 1 ? 's' : '' }} &nbsp;·&nbsp;
          Priority {{ ss.priority }} &nbsp;·&nbsp;
          {{ ss.schedule?.type === 'always' ? 'Always active' : 'Scheduled' }}
        </div>
      </div>

      <!-- Publish / Disable toggle (a hidden slideshow is unhidden first) -->
      <button
        v-if="!ss.hidden"
        :style="{
          fontSize: '12px',
          padding: '5px 12px',
          borderRadius: 'var(--radius)',
          border: 'none',
          cursor: togglingFolder === ss.folder ? 'not-allowed' : 'pointer',
          fontWeight: '600',
          background: ss.enabled !== false ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
          color:      ss.enabled !== false ? '#dc2626'              : '#16a34a',
          outline:    ss.enabled !== false ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.3)',
        }"
        :disabled="togglingFolder === ss.folder"
        @click.stop="toggleEnabled(ss.folder, ss.enabled !== false)"
      >{{ ss.enabled !== false ? 'Disable' : 'Publish' }}</button>

      <button
        class="btn-ghost"
        style="font-size:12px;padding:5px 10px"
        @click="router.push(`/slideshows/${ss.folder}`)"
      >Manage</button>
      <button
        v-if="ss.hidden"
        class="btn-ghost"
        style="font-size:12px;padding:5px 10px"
        :disabled="hidingFolder === ss.folder"
        @click="setHidden(ss, false)"
      >Unhide</button>
      <button
        v-else
        class="btn-ghost"
        style="font-size:12px;padding:5px 10px"
        :disabled="hidingFolder === ss.folder || ss.enabled !== false"
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

    <button v-if="hiddenCount" class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="showHidden = !showHidden">
      {{ showHidden ? 'Hide hidden slideshows' : `Show hidden slideshows (${hiddenCount})` }}
    </button>
  </div>
</template>

<style scoped>
.tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-muted);
  border: 1px solid var(--border);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.card--hidden { opacity: 0.7; border-style: dashed; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
