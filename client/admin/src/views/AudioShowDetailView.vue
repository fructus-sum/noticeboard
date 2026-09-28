<script setup>
// client/admin/src/views/AudioShowDetailView.vue — one audio show (/admin/audio/:folder)
//
// Loads the show (404 → back to the list) and its tracks; the header with its name and status; its
// settings card, "Preview the show", its event audio card and its track list (SYSTEM_DESIGN §18.3).
//
// Used by: router/index.js
// Uses: useApi, audio/AudioShowSettingsCard, audio/ShowPreview, audio/AudioEventCard, audio/TrackList,
//   ui/StatusBadge
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';
import AudioShowSettingsCard from '../components/audio/AudioShowSettingsCard.vue';
import TrackList from '../components/audio/TrackList.vue';
import ShowPreview from '../components/audio/ShowPreview.vue';
import AudioEventCard from '../components/audio/AudioEventCard.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';

const route = useRoute();
const router = useRouter();
const folder = route.params.folder;
const show = ref(null);
const tracks = ref([]);
const error = ref('');
const readyTracks = computed(() => tracks.value.filter((t) => t.status === 'ready').length);

onMounted(async () => {
  try {
    [show.value, tracks.value] = await Promise.all([
      api.get(`/audioshows/${folder}`),
      api.get(`/audioshows/${folder}/tracks`),
    ]);
  } catch (e) {
    if (e.status === 404) router.replace('/audio');
    else error.value = e.message;
  }
});
</script>

<template>
  <div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px" @click="router.push('/audio')">← Back</button>
      <h1 style="margin:0">{{ show?.name ?? 'Audio show' }}</h1>
      <StatusBadge v-if="show" :published="show.enabled" />
    </div>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <template v-if="show">
      <AudioShowSettingsCard :show="show" @change="(saved) => { show = saved; }" />
      <ShowPreview :show="show" :tracks="tracks" />
      <AudioEventCard :show="show" :ready-tracks="readyTracks" @change="(saved) => { show = saved; }" />
      <TrackList v-model:tracks="tracks" :folder="folder" :volume="show.volume" />
    </template>
  </div>
</template>
