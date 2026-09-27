<script setup>
// client/admin/src/views/SlideshowDetailView.vue — one slideshow's page (/admin/slideshows/:folder)
//
// Responsibilities
//   Loads the default image duration (Settings → Display), the slideshow and its slides, then shows
//   the header (name, Sample and Hidden tags), the settings card, a warning while it's disabled, and
//   the slide list. A slideshow that doesn't exist (any more) goes back to the list.
//
// Used by: router/index.js
// Uses: useApi (GET /settings, /slideshows/:folder, /slideshows/:folder/slides), SlideshowSettingsCard,
//   SlideList, TagPill
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';
import SlideshowSettingsCard from '../components/slideshow/SlideshowSettingsCard.vue';
import SlideList from '../components/slideshow/SlideList.vue';
import TagPill from '../components/ui/TagPill.vue';

const route  = useRoute();
const router = useRouter();
const folder = route.params.folder;

const meta           = ref(null);
const slides         = ref([]);
const error          = ref('');
const defaultSeconds = ref(10);   // Settings → Display

async function loadMeta() {
  try {
    meta.value = await api.get(`/slideshows/${folder}`);
  } catch (e) {
    if (e.status === 404) { router.push('/slideshows'); return; }
    throw e;
  }
}

async function loadDefaultDuration() {
  try {
    defaultSeconds.value = (await api.get('/settings')).display?.defaultSlideDurationSeconds ?? 10;
  } catch {
    // Shown without the number
  }
}

async function init() {
  try {
    await loadDefaultDuration();
    await loadMeta();
    slides.value = await api.get(`/slideshows/${folder}/slides`);
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(init);
</script>

<template>
  <div v-if="error"><p class="error-msg">{{ error }}</p></div>
  <div v-else-if="!meta" style="color:var(--text-muted)">Loading…</div>
  <div v-else>
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:20px">
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="router.push('/slideshows')">← Back</button>
      <h1 style="margin:0">{{ meta.name }}</h1>
      <TagPill v-if="meta.sample" title="Shows what the noticeboard can do. It is updated with new examples when the software is updated, and can’t be deleted.">Sample</TagPill>
      <TagPill v-if="meta.hidden">Hidden</TagPill>
    </div>

    <SlideshowSettingsCard
      :folder="folder"
      :slideshow="meta"
      :default-seconds="defaultSeconds"
      @change="(patch) => { meta = { ...meta, ...patch }; }"
    />

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

    <SlideList v-model:slides="slides" :folder="folder" />
  </div>
</template>
