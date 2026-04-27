<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';

const route  = useRoute();
const router = useRouter();
const folder = route.params.folder;

// Slideshow metadata
const meta    = ref(null);
const slides  = ref([]);
const error   = ref('');

// Edit metadata form
const editing    = ref(false);
const editName   = ref('');
const editPrio   = ref(1);
const editSched  = ref({ type: 'always' });
const saving     = ref(false);
const saveMsg    = ref('');

// Upload
const fileInput  = ref(null);
const uploading  = ref(false);
const uploadErr  = ref('');

// Polling for processing slides
let pollTimer = null;
const hasProcessing = computed(() => slides.value.some(s => s.status === 'processing'));

async function loadMeta() {
  try {
    meta.value = await api.get(`/slideshows/${folder}`);
  } catch (e) {
    if (e.status === 404) { router.push('/slideshows'); return; }
    throw e;
  }
  editName.value  = meta.value.name;
  editPrio.value  = meta.value.priority;
  editSched.value = meta.value.schedule ? JSON.parse(JSON.stringify(meta.value.schedule)) : { type: 'always' };
}

async function loadSlides() {
  slides.value = await api.get(`/slideshows/${folder}/slides`);
}

async function init() {
  try {
    await loadMeta();
    await loadSlides();
  } catch (e) {
    error.value = e.message;
  }
}

// Poll while any slide is processing
watch(hasProcessing, (v) => {
  if (v && !pollTimer) {
    pollTimer = setInterval(async () => {
      await loadSlides().catch(() => {});
      if (!hasProcessing.value) { clearInterval(pollTimer); pollTimer = null; }
    }, 2000);
  }
});

async function saveMeta() {
  saveMsg.value = '';
  saving.value = true;
  try {
    const updated = await api.put(`/slideshows/${folder}`, {
      name:     editName.value.trim(),
      priority: Number(editPrio.value),
      schedule: editSched.value,
    });
    meta.value = { ...meta.value, ...updated };
    editing.value = false;
    saveMsg.value = 'Saved.';
    setTimeout(() => { saveMsg.value = ''; }, 2000);
  } catch (e) {
    saveMsg.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function uploadFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  uploadErr.value = '';
  uploading.value = true;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const slide = await api.upload(`/slideshows/${folder}/slides`, fd);
    slides.value.push(slide);
  } catch (err) {
    uploadErr.value = err.message;
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function deleteSlide(id) {
  if (!confirm('Delete this slide?')) return;
  try {
    await api.del(`/slideshows/${folder}/slides/${id}`);
    slides.value = slides.value.filter(s => s.id !== id);
  } catch (e) {
    alert(e.message);
  }
}

async function move(index, dir) {
  const newSlides = [...slides.value];
  const target = index + dir;
  if (target < 0 || target >= newSlides.length) return;
  [newSlides[index], newSlides[target]] = [newSlides[target], newSlides[index]];
  slides.value = newSlides;
  await api.put(`/slideshows/${folder}/slides/reorder`, { order: newSlides.map(s => s.id) }).catch(() => {});
}

onMounted(init);
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<template>
  <div v-if="error"><p class="error-msg">{{ error }}</p></div>
  <div v-else-if="!meta" style="color:var(--text-muted)">Loading…</div>
  <div v-else>
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="router.push('/slideshows')">← Back</button>
      <h1 style="margin:0">{{ meta.name }}</h1>
    </div>

    <!-- Metadata card -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Settings</h2>
        <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="editing = !editing">
          {{ editing ? 'Cancel' : 'Edit' }}
        </button>
      </div>

      <div v-if="!editing" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:13px">
        <div><span style="color:var(--text-muted)">Name</span><br>{{ meta.name }}</div>
        <div><span style="color:var(--text-muted)">Priority</span><br>{{ meta.priority }}</div>
        <div><span style="color:var(--text-muted)">Schedule</span><br>
          {{ meta.schedule?.type === 'always' ? 'Always active' : `Timed (${meta.schedule.startTime}–${meta.schedule.endTime})` }}
        </div>
      </div>

      <form v-else @submit.prevent="saveMeta">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
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
          <label>Schedule</label>
          <select v-model="editSched.type">
            <option value="always">Always active</option>
            <option value="timed">Timed</option>
          </select>
        </div>
        <div v-if="editSched.type === 'timed'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="field">
            <label>Start time</label>
            <input v-model="editSched.startTime" type="time" />
          </div>
          <div class="field">
            <label>End time</label>
            <input v-model="editSched.endTime" type="time" />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Active days</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
              <label v-for="(day, i) in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']" :key="i"
                style="display:flex;align-items:center;gap:4px;font-weight:400;color:var(--text);font-size:13px">
                <input
                  type="checkbox"
                  style="width:auto"
                  :value="i"
                  :checked="(editSched.days ?? [0,1,2,3,4,5,6]).includes(i)"
                  @change="e => {
                    const days = [...(editSched.days ?? [0,1,2,3,4,5,6])];
                    if (e.target.checked) { if (!days.includes(i)) days.push(i); }
                    else { const idx = days.indexOf(i); if (idx !== -1) days.splice(idx, 1); }
                    editSched.days = days.sort((a,b) => a-b);
                  }"
                />{{ day }}
              </label>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
          <span :class="saveMsg.startsWith('Saved') ? 'success-msg' : 'error-msg'" v-if="saveMsg">{{ saveMsg }}</span>
        </div>
      </form>
    </div>

    <!-- Slides card -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Slides ({{ slides.length }})</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <span v-if="uploadErr" class="error-msg">{{ uploadErr }}</span>
          <label class="btn-primary" style="cursor:pointer;display:inline-block;font-size:13px;padding:7px 14px;border-radius:var(--radius);font-weight:500">
            {{ uploading ? 'Uploading…' : '+ Upload' }}
            <input ref="fileInput" type="file" accept="image/*,video/*" style="display:none" :disabled="uploading" @change="uploadFile" />
          </label>
        </div>
      </div>

      <p v-if="!slides.length" style="color:var(--text-muted)">No slides yet. Upload an image or video.</p>

      <div v-for="(slide, i) in slides" :key="slide.id" class="slide-row">
        <div class="slide-thumb">
          <img v-if="slide.type === 'image' && slide.status === 'ready'" :src="slide.filename ? `/media/${folder}/slides/${slide.filename}` : ''" />
          <div v-else-if="slide.type === 'video'" class="slide-thumb__icon">▶</div>
          <div v-else class="slide-thumb__icon">?</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--text-muted)">{{ slide.type }}</div>
          <div style="font-size:12px;word-break:break-all">{{ slide.filename ?? '—' }}</div>
        </div>
        <span class="badge" :class="`badge--${slide.status}`">{{ slide.status }}</span>
        <div style="display:flex;gap:4px">
          <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :disabled="i === 0" @click="move(i, -1)">↑</button>
          <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :disabled="i === slides.length - 1" @click="move(i, 1)">↓</button>
          <button class="btn-danger" style="padding:4px 8px;font-size:12px" @click="deleteSlide(slide.id)">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slide-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.slide-row:last-child { border-bottom: none; }

.slide-thumb {
  width: 56px;
  height: 40px;
  background: var(--surface-2);
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.slide-thumb img { width: 100%; height: 100%; object-fit: cover; }
.slide-thumb__icon { font-size: 16px; color: var(--text-muted); }
</style>
