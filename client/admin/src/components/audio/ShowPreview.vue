<script setup>
// client/admin/src/components/audio/ShowPreview.vue — "Preview the show", on an audio show's page
//
// Plays the show here in the browser exactly as the screens will: the same engine
// (shared/audioPlayer.mjs) with its order, transition, fade length and volume, so the settings can
// be tried before the show is published. ▶ Play, ⏭ Next track, ■ Stop; it shows the track playing.
// It uses the show as it is on the page (saved settings and ready tracks), and stops when the page
// is left.
//
// Props: show (the page's copy), tracks (the list as the server returns it)
// Used by: views/AudioShowDetailView
// Uses: createAudioPlayer from @shared/audioPlayer.mjs; audioUrl and mediaDisplayName from @shared
import { ref, computed, watch, onUnmounted } from 'vue';
import { createAudioPlayer } from '@shared/audioPlayer.mjs';
import { audioUrl, mediaDisplayName } from '@shared/index.js';

const props = defineProps({
  show: { type: Object, required: true },
  tracks: { type: Array, required: true },
});

const ready = computed(() => props.tracks.filter((t) => t.status === 'ready' && t.filename));
const state = ref({ show: null, track: null, playing: false, blocked: false });
const player = createAudioPlayer({ createElement: () => new Audio(), onChange: (s) => { state.value = s; } });

// What the engine plays: the show's settings and its ready tracks
const asPlayed = computed(() => ({
  id: props.show.folder,
  order: props.show.order,
  transition: props.show.transition,
  fadeSeconds: props.show.fadeSeconds,
  volume: props.show.volume,
  tracks: ready.value.map((t) => ({ url: audioUrl(props.show.folder, t.filename), length: t.duration })),
}));

const on = computed(() => state.value.show !== null);
const nowPlaying = computed(() => {
  const i = state.value.track;
  return on.value && i !== null ? mediaDisplayName(ready.value[i] ?? {}) : '';
});

// From the start (stop first, so the same show asked for again really restarts)
function play() {
  player.stop();
  player.setShow(asPlayed.value);
}
function stop() {
  player.stop();
}

// Changed settings or tracks while it plays: the engine carries on with them (a new volume at
// once; a change to the tracks, order, transition or fade starts its next track)
watch(asPlayed, (s) => { if (on.value) player.setShow(s); }, { deep: true });
onUnmounted(() => player.destroy());
</script>

<template>
  <div class="preview">
    <button v-if="!on" type="button" class="btn-primary" :disabled="!ready.length" @click="play">▶ Preview the show</button>
    <template v-else>
      <button type="button" class="btn-ghost" @click="player.next()">⏭ Next track</button>
      <button type="button" class="btn-ghost" @click="stop">■ Stop</button>
      <span class="preview__now">
        <template v-if="state.blocked">Your browser didn't allow sound. <button type="button" class="btn-ghost" @click="player.retryNow()">▶ Try again</button></template>
        <template v-else>Playing: <strong>{{ nowPlaying }}</strong></template>
      </span>
    </template>
    <span v-if="!ready.length" class="preview__note">Upload a track to preview the show.</span>
  </div>
</template>

<style scoped>
.preview { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: -4px 0 16px; }
.preview__now { font-size: 13px; }
.preview__note { font-size: 12px; color: var(--text-muted); }
</style>
