<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';
import SlidePreview from '../components/SlidePreview.vue';

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
const editOwnDuration = ref(false);   // false: the default from Settings
const editSeconds     = ref(10);
const defaultSeconds  = ref(10);       // Settings → Display
const saving     = ref(false);
const saveMsg    = ref('');

// Publish / disable toggle
const toggling = ref(false);

async function toggleEnabled() {
  toggling.value = true;
  try {
    const updated = await api.put(`/slideshows/${folder}`, { enabled: !(meta.value.enabled !== false) });
    meta.value = { ...meta.value, enabled: updated.enabled };
  } catch (e) {
    alert(e.message);
  } finally {
    toggling.value = false;
  }
}

// Hide / unhide: only while unpublished; the slideshow is kept exactly as it is
const hiding = ref(false);

async function setHidden(hidden) {
  hiding.value = true;
  try {
    const updated = await api.put(`/slideshows/${folder}`, { hidden });
    meta.value = { ...meta.value, hidden: updated.hidden === true };
  } catch (e) {
    alert(e.message);
  } finally {
    hiding.value = false;
  }
}

// Larger preview of a slide: hover shows it, click/tap pins it
const preview = ref(null);   // { slide, position, pinned }
let hoverTimer = null;

function hoverStart(slide, i) {
  if (preview.value?.pinned) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => { preview.value = { slide, position: i + 1, pinned: false }; }, 250);
}
function hoverEnd() {
  clearTimeout(hoverTimer);
  if (!preview.value?.pinned) preview.value = null;
}
function pinPreview(slide, i) {
  clearTimeout(hoverTimer);
  preview.value = { slide, position: i + 1, pinned: true };
}
function closePreview() {
  clearTimeout(hoverTimer);
  preview.value = null;
}
function onKey(e) {
  if (e.key === 'Escape' && preview.value) closePreview();
}

// Videos without a thumbnail (uploaded before thumbnails existed): the server makes them
const missingThumbnails = computed(() => slides.value.filter(s =>
  s.type === 'video' && s.status === 'ready' && !s.thumbnail && !s.thumbnailPending));
const thumbnailsFailed = computed(() => missingThumbnails.value.some(s => s.thumbnailError));
const creatingThumbs = ref(false);
const thumbMsg = ref('');

async function createThumbnails() {
  creatingThumbs.value = true;
  thumbMsg.value = '';
  try {
    await api.post(`/slideshows/${folder}/slides/thumbnails`);
    await loadSlides();
  } catch (e) {
    thumbMsg.value = e.message;
  } finally {
    creatingThumbs.value = false;
  }
}

// Upload
const fileInput    = ref(null);
const uploading    = ref(false);
const uploadErr    = ref('');
const uploadCount  = ref(0);

// Polling for processing slides
let pollTimer = null;
const hasProcessing = computed(() => slides.value.some(s => s.status === 'processing' || s.thumbnailPending));

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
  editOwnDuration.value = meta.value.slideDurationSeconds != null;
  editSeconds.value = meta.value.slideDurationSeconds ?? defaultSeconds.value;
}

async function loadDefaultDuration() {
  try {
    defaultSeconds.value = (await api.get('/settings')).display?.defaultSlideDurationSeconds ?? 10;
  } catch {
    // Shown without the number
  }
}

async function loadSlides() {
  slides.value = await api.get(`/slideshows/${folder}/slides`);
}

async function init() {
  try {
    await loadDefaultDuration();
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
      slideDurationSeconds: editOwnDuration.value ? Number(editSeconds.value) : null,
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
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  uploadErr.value = '';
  uploading.value = true;
  uploadCount.value = files.length;
  const fd = new FormData();
  for (const file of files) fd.append('files', file);
  try {
    const newSlides = await api.upload(`/slideshows/${folder}/slides`, fd);
    slides.value.push(...newSlides);
  } catch (err) {
    uploadErr.value = err.message;
  } finally {
    uploading.value = false;
    uploadCount.value = 0;
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

onMounted(() => {
  init();
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  clearTimeout(hoverTimer);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div v-if="error"><p class="error-msg">{{ error }}</p></div>
  <div v-else-if="!meta" style="color:var(--text-muted)">Loading…</div>
  <div v-else>
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="router.push('/slideshows')">← Back</button>
      <h1 style="margin:0">{{ meta.name }}</h1>
      <span v-if="meta.sample" class="tag" title="Shows what the noticeboard can do. It is updated with new examples when the software is updated, and can’t be deleted.">Sample</span>
      <span v-if="meta.hidden" class="tag">Hidden</span>
    </div>

    <!-- Metadata card -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Settings</h2>
        <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="editing = !editing">
          {{ editing ? 'Cancel' : 'Edit' }}
        </button>
      </div>

      <div v-if="!editing" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;font-size:13px;align-items:start">
        <div><span style="color:var(--text-muted)">Name</span><br>{{ meta.name }}</div>
        <div><span style="color:var(--text-muted)">Priority</span><br>{{ meta.priority }}</div>
        <div><span style="color:var(--text-muted)">Image duration</span><br>
          <template v-if="meta.slideDurationSeconds != null">{{ meta.slideDurationSeconds }} s (this slideshow)</template>
          <template v-else>{{ defaultSeconds }} s (the default)</template>
        </div>
        <div><span style="color:var(--text-muted)">Schedule</span><br>
          {{ meta.schedule?.type === 'always' ? 'Always active' : `Timed (${meta.schedule.startTime}–${meta.schedule.endTime})` }}
        </div>
        <div>
          <span style="color:var(--text-muted)">Status</span><br>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
            <span
              :style="{
                fontSize: '11px',
                fontWeight: '600',
                padding: '2px 7px',
                borderRadius: '10px',
                background: meta.enabled !== false ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)',
                color:      meta.enabled !== false ? '#16a34a'              : 'var(--text-muted)',
                border:     meta.enabled !== false ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(148,163,184,0.25)',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }"
            >{{ meta.enabled !== false ? 'Published' : 'Disabled' }}</span>
            <button
              :style="{
                fontSize: '11px',
                padding: '3px 10px',
                borderRadius: 'var(--radius)',
                border: 'none',
                cursor: toggling ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                background: meta.enabled !== false ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                color:      meta.enabled !== false ? '#dc2626'              : '#16a34a',
                outline:    meta.enabled !== false ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.3)',
              }"
              :disabled="toggling"
              @click="toggleEnabled"
            >{{ meta.enabled !== false ? 'Disable' : 'Publish' }}</button>
            <button
              v-if="meta.enabled === false"
              class="btn-ghost"
              style="font-size:11px;padding:3px 10px"
              :disabled="hiding"
              :title="meta.hidden ? 'Show it in the slideshow list again' : 'Hide it from the slideshow list, keeping it exactly as it is'"
              @click="setHidden(!meta.hidden)"
            >{{ meta.hidden ? 'Unhide' : 'Hide' }}</button>
          </div>
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
          <label>Image duration</label>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;font-size:13px">
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;color:var(--text);margin:0">
              <input v-model="editOwnDuration" type="radio" :value="false" style="width:auto" />
              Use the default ({{ defaultSeconds }} s, set in Settings)
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;color:var(--text);margin:0">
              <input v-model="editOwnDuration" type="radio" :value="true" style="width:auto" />
              Use its own:
              <input v-model.number="editSeconds" type="number" min="1" max="3600" :disabled="!editOwnDuration" style="width:90px" /> seconds
            </label>
          </div>
          <p style="color:var(--text-muted);font-size:12px;margin-top:4px">How long each image shows. Videos always play to the end.</p>
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

    <!-- Disabled warning banner -->
    <div
      v-if="meta && meta.enabled === false"
      style="
        margin-bottom: 16px;
        padding: 12px 16px;
        border-radius: var(--radius);
        background: rgba(251,191,36,0.08);
        border: 1px solid rgba(251,191,36,0.25);
        color: #d97706;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
      "
    >
      <span style="font-size:16px">⚠</span>
      <span>This slideshow is <strong>disabled</strong> — it will not appear on the display regardless of schedule settings. Click <strong>Publish</strong> above to make it live.</span>
    </div>

    <!-- Slides card -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Slides ({{ slides.length }})</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <span v-if="uploadErr" class="error-msg">{{ uploadErr }}</span>
          <label class="btn-primary" style="cursor:pointer;display:inline-block;font-size:13px;padding:7px 14px;border-radius:var(--radius);font-weight:500">
            {{ uploading ? `Uploading${uploadCount > 1 ? ` ${uploadCount} files` : ''}…` : '+ Upload' }}
            <input ref="fileInput" type="file" accept="image/*,video/*" multiple style="display:none" :disabled="uploading" @change="uploadFile" />
          </label>
        </div>
      </div>

      <p v-if="!slides.length" style="color:var(--text-muted)">No slides yet. Upload an image or video.</p>
      <p v-else style="color:var(--text-muted);font-size:12px;margin-bottom:6px">
        Hover over a thumbnail, or click or tap it, for a larger view. Large videos take a while to process after
        uploading: carry on setting up meanwhile, and they appear by themselves when they’re ready.
      </p>

      <div v-if="missingThumbnails.length" class="thumb-note">
        <span>
          {{ missingThumbnails.length }} video{{ missingThumbnails.length > 1 ? 's have' : ' has' }} no thumbnail{{ thumbnailsFailed ? ' (the last try failed)' : '' }}.
          The noticeboard can make {{ missingThumbnails.length > 1 ? 'them' : 'one' }} from a frame of each video.
        </span>
        <button class="btn-ghost" style="font-size:12px;padding:4px 10px" :disabled="creatingThumbs" @click="createThumbnails">
          {{ creatingThumbs ? 'Starting…' : 'Create thumbnails' }}
        </button>
        <span v-if="thumbMsg" class="error-msg">{{ thumbMsg }}</span>
      </div>

      <div v-for="(slide, i) in slides" :key="slide.id" class="slide-row">
        <button
          type="button"
          class="slide-thumb"
          :aria-label="`Show slide ${i + 1} larger`"
          @mouseenter="hoverStart(slide, i)"
          @mouseleave="hoverEnd"
          @click="pinPreview(slide, i)"
        >
          <img v-if="slide.type === 'image' && slide.status === 'ready'" :src="slide.filename ? `/media/${folder}/slides/${slide.filename}` : ''" alt="" />
          <template v-else-if="slide.type === 'video'">
            <img v-if="slide.thumbnail" :src="`/media/${folder}/slides/${slide.thumbnail}`" alt="" />
            <span class="slide-thumb__play" aria-hidden="true">▶</span>
          </template>
          <div v-else class="slide-thumb__icon">?</div>
        </button>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--text-muted)">
            {{ slide.type }}<template v-if="slide.thumbnailPending"> · making a thumbnail…</template>
          </div>
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

    <SlidePreview
      v-if="preview"
      :slide="preview.slide"
      :folder="folder"
      :position="preview.position"
      :pinned="preview.pinned"
      @close="closePreview"
    />
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
  position: relative;
  width: 72px;
  height: 48px;
  padding: 0;
  background: var(--surface-2);
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: zoom-in;
}
.slide-thumb:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.slide-thumb img { width: 100%; height: 100%; object-fit: cover; }
.slide-thumb__icon { font-size: 16px; color: var(--text-muted); }
.slide-thumb__play {
  position: absolute;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

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

.thumb-note {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 13px;
}
</style>
