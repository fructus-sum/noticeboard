<script setup>
// client/admin/src/components/slideshow/SlideList.vue — a slideshow's slides on its page
//
// Responsibilities
//   Uploading (several files at once), the rows with a thumbnail, name, type, stored file name and
//   status, renaming a slide (✎: Enter or leaving the field saves, Esc cancels; an empty name goes
//   back to the uploaded file's name), moving a slide up or down, deleting one, making missing
//   video thumbnails, and the larger preview (hover shows it, a click or tap pins it; Esc or ✕
//   closes it). While a slide is being processed or its thumbnail made, the list reloads every 2
//   seconds until none is.
//
// Props: folder. v-model:slides, the list as the server returns it (the page loads it first).
//
// Used by: views/SlideshowDetailView
// It stays open while a slide or an upload has failed (a warning).
// Uses: useApi (the slides routes), SlidePreview, CollapsibleCard; mediaUrl, mediaDisplayName and LIMITS from @shared
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { mediaUrl, mediaDisplayName, LIMITS } from '@shared/index.js';
import { api } from '../../composables/useApi.js';
import SlidePreview from './SlidePreview.vue';
import CollapsibleCard from '../ui/CollapsibleCard.vue';

const props = defineProps({ folder: { type: String, required: true } });
const slides = defineModel('slides', { type: Array, required: true });

async function loadSlides() {
  slides.value = await api.get(`/slideshows/${props.folder}/slides`);
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
    await api.post(`/slideshows/${props.folder}/slides/thumbnails`);
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

async function uploadFile(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  uploadErr.value = '';
  uploading.value = true;
  uploadCount.value = files.length;
  const fd = new FormData();
  for (const file of files) fd.append('files', file);
  try {
    const newSlides = await api.upload(`/slideshows/${props.folder}/slides`, fd);
    slides.value.push(...newSlides);
  } catch (err) {
    uploadErr.value = err.message;
  } finally {
    uploading.value = false;
    uploadCount.value = 0;
    if (fileInput.value) fileInput.value.value = '';
  }
}

// Something the admin must see: a slide that failed to process, or an upload that failed
const attention = computed(() => !!uploadErr.value || slides.value.some(s => s.status === 'error'));

// Polling while any slide is processing
let pollTimer = null;
const hasProcessing = computed(() => slides.value.some(s => s.status === 'processing' || s.thumbnailPending));

watch(hasProcessing, (v) => {
  if (v && !pollTimer) {
    pollTimer = setInterval(async () => {
      await loadSlides().catch(() => {});
      if (!hasProcessing.value) { clearInterval(pollTimer); pollTimer = null; }
    }, 2000);
  }
}, { immediate: true });

// Renaming: one slide at a time, in place of its name
const renaming = ref(null);   // { id, value, saving, error }
const renameInput = ref(null);

async function startRename(slide) {
  renaming.value = { id: slide.id, value: slide.name || slide.originalName || '', saving: false, error: '' };
  await nextTick();
  renameInput.value?.[0]?.select();
}
function cancelRename() {
  renaming.value = null;
}
async function saveRename() {
  const r = renaming.value;
  if (!r || r.saving) return;
  const slide = slides.value.find(s => s.id === r.id);
  if (!slide) return cancelRename();
  const name = r.value.trim();
  if (name === (slide.name || slide.originalName || '') || (!name && !slide.name)) return cancelRename();
  r.saving = true;
  try {
    const saved = await api.patch(`/slideshows/${props.folder}/slides/${r.id}`, { name });
    slides.value = slides.value.map(s => (s.id === saved.id ? saved : s));
    renaming.value = null;
  } catch (e) {
    r.saving = false;
    r.error = e.message;
  }
}

async function deleteSlide(slide) {
  if (!confirm(`Delete “${mediaDisplayName(slide)}”?`)) return;
  try {
    await api.del(`/slideshows/${props.folder}/slides/${slide.id}`);
    slides.value = slides.value.filter(s => s.id !== slide.id);
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
  await api.put(`/slideshows/${props.folder}/slides/reorder`, { order: newSlides.map(s => s.id) }).catch(() => {});
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  clearTimeout(hoverTimer);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <CollapsibleCard :title="`Slides (${slides.length})`" name="slideshow-slides" :attention="attention">
    <template #actions>
        <span v-if="uploadErr" class="error-msg">{{ uploadErr }}</span>
        <label class="btn-primary" style="cursor:pointer;display:inline-block;font-size:13px;padding:7px 14px;border-radius:var(--radius);font-weight:500">
          {{ uploading ? `Uploading${uploadCount > 1 ? ` ${uploadCount} files` : ''}…` : '+ Upload' }}
          <input ref="fileInput" type="file" accept="image/*,video/*" multiple style="display:none" :disabled="uploading" @change="uploadFile" />
        </label>
    </template>

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
        :aria-label="`Show “${mediaDisplayName(slide)}” larger`"
        @mouseenter="hoverStart(slide, i)"
        @mouseleave="hoverEnd"
        @click="pinPreview(slide, i)"
      >
        <img v-if="slide.type === 'image' && slide.status === 'ready'" :src="slide.filename ? mediaUrl(folder, slide.filename) : ''" alt="" />
        <template v-else-if="slide.type === 'video'">
          <img v-if="slide.thumbnail" :src="mediaUrl(folder, slide.thumbnail)" alt="" />
          <span class="slide-thumb__play" aria-hidden="true">▶</span>
        </template>
        <div v-else class="slide-thumb__icon">?</div>
      </button>
      <div class="slide-info">
        <template v-if="renaming?.id === slide.id">
          <input
            ref="renameInput"
            v-model="renaming.value"
            class="slide-name-input"
            :maxlength="LIMITS.mediaNameMax"
            :disabled="renaming.saving"
            aria-label="Slide name"
            @keydown.enter.prevent="saveRename"
            @keydown.esc.stop="cancelRename"
            @blur="saveRename"
          />
          <div v-if="renaming.error" class="error-msg" style="font-size:12px">{{ renaming.error }}</div>
        </template>
        <div v-else class="slide-name">{{ mediaDisplayName(slide) }}</div>
        <div class="slide-detail">
          {{ slide.type }}<template v-if="slide.filename"> · {{ slide.filename }}</template><template v-if="slide.thumbnailPending"> · making a thumbnail…</template>
        </div>
      </div>
      <span class="badge" :class="`badge--${slide.status}`">{{ slide.status }}</span>
      <div style="display:flex;gap:4px">
        <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :aria-label="`Rename “${mediaDisplayName(slide)}”`" title="Rename" :disabled="renaming?.id === slide.id" @click="startRename(slide)">✎</button>
        <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :disabled="i === 0" @click="move(i, -1)">↑</button>
        <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :disabled="i === slides.length - 1" @click="move(i, 1)">↓</button>
        <button class="btn-danger" style="padding:4px 8px;font-size:12px" @click="deleteSlide(slide)">✕</button>
      </div>
    </div>
  </CollapsibleCard>

  <SlidePreview
    v-if="preview"
    :slide="preview.slide"
    :folder="folder"
    :position="preview.position"
    :pinned="preview.pinned"
    @close="closePreview"
  />
</template>

<style scoped>
.slide-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;   /* on a narrow screen the buttons go under, making the row taller */
  gap: 8px 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.slide-row:last-child { border-bottom: none; }

.slide-info { flex: 1; min-width: 0; }
.slide-name { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.slide-name-input { width: 100%; font-size: 14px; padding: 3px 6px; }
.slide-detail { font-size: 12px; color: var(--text-muted); word-break: break-all; }

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
