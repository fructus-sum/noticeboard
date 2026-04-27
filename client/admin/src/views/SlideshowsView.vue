<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';

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
</script>

<template>
  <div>
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

    <div v-for="ss in slideshows" :key="ss.folder" class="card" style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;cursor:pointer" @click="router.push(`/slideshows/${ss.folder}`)">
        <div style="font-weight:600">{{ ss.name }}</div>
        <div style="color:var(--text-muted);font-size:12px;margin-top:2px">
          {{ ss.slideCount }} slide{{ ss.slideCount !== 1 ? 's' : '' }} &nbsp;·&nbsp;
          Priority {{ ss.priority }} &nbsp;·&nbsp;
          {{ ss.schedule?.type === 'always' ? 'Always active' : 'Scheduled' }}
        </div>
      </div>
      <button
        class="btn-ghost"
        style="font-size:12px;padding:5px 10px"
        @click="router.push(`/slideshows/${ss.folder}`)"
      >Manage</button>
      <button
        class="btn-danger"
        style="font-size:12px;padding:5px 10px"
        :disabled="deletingFolder === ss.folder"
        @click="remove(ss.folder)"
      >Delete</button>
    </div>
  </div>
</template>
