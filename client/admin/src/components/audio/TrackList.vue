<script setup>
// client/admin/src/components/audio/TrackList.vue — an audio show's tracks, on its page
//
// Responsibilities
//   Uploading (several files at once: MP3, WAV, Ogg, AAC/M4A, FLAC…; the server converts them to AAC
//   with even loudness), the rows with ▶ to listen (one track at a time, at the show's volume), the
//   name (✎ renames it: useRename), length, stored file name and status, moving a track up or down,
//   and deleting one. While a track is being processed the list reloads every 2 seconds.
//
// Props: folder, volume (the show's, 0–100). v-model:tracks, the list as the server returns it.
// Used by: views/AudioShowDetailView
// Uses: useItemList (upload, reloading, delete, reorder), useRename, CollapsibleCard; audioUrl,
//   mediaDisplayName and LIMITS from @shared
import { ref, computed, onUnmounted } from 'vue';
import { audioUrl, mediaDisplayName, LIMITS } from '@shared/index.js';
import { useItemList } from '../../composables/useItemList.js';
import { useRename } from '../../composables/useRename.js';
import CollapsibleCard from '../ui/CollapsibleCard.vue';

const props = defineProps({
  folder: { type: String, required: true },
  volume: { type: Number, default: 100 },
});
const tracks = defineModel('tracks', { type: Array, required: true });

const { fileInput, uploading, uploadErr, uploadCount, upload, remove, move, moveErr, stop } = useItemList({
  items: tracks,
  path: () => `/audioshows/${props.folder}/tracks`,
});
const { renaming, renameInput, startRename, cancelRename, saveRename } = useRename({
  items: tracks,
  path: (track) => `/audioshows/${props.folder}/tracks/${track.id}`,
});

// Something the admin must see: a track that failed to process, or an upload that failed
const attention = computed(() => !!uploadErr.value || !!moveErr.value || tracks.value.some(t => t.status === 'error'));

const length = (seconds) => (seconds == null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);

// Listening to one track
const playing = ref(null);   // the id of the track playing
let player = null;
function listen(track) {
  if (player) player.pause();
  if (playing.value === track.id) {
    playing.value = null;
    return;
  }
  player = new Audio(audioUrl(props.folder, track.filename));
  player.volume = Math.max(0, Math.min(1, props.volume / 100));
  player.onended = () => { playing.value = null; };
  player.onerror = () => { playing.value = null; };
  player.play().then(() => { playing.value = track.id; }, () => { playing.value = null; });
}

onUnmounted(() => {
  stop();
  if (player) player.pause();
});
</script>

<template>
  <CollapsibleCard :title="`Tracks (${tracks.length})`" name="audio-tracks" :attention="attention">
    <template #actions>
      <span v-if="uploadErr" class="error-msg">{{ uploadErr }}</span>
      <span v-if="moveErr" class="error-msg move-error">{{ moveErr }}</span>
      <label class="btn-primary" style="cursor:pointer;display:inline-block;font-size:13px;padding:7px 14px;border-radius:var(--radius);font-weight:500">
        {{ uploading ? `Uploading${uploadCount > 1 ? ` ${uploadCount} files` : ''}…` : '+ Upload' }}
        <input ref="fileInput" type="file" accept="audio/*" multiple style="display:none" :disabled="uploading" @change="upload" />
      </label>
    </template>

    <p v-if="!tracks.length" style="color:var(--text-muted)">No tracks yet. Upload a music or sound file.</p>
    <p v-else style="color:var(--text-muted);font-size:12px;margin-bottom:6px">
      ▶ plays a track here, at this show's volume. Uploaded tracks take a moment to process: each is converted and its
      loudness evened out.
    </p>

    <div v-for="(track, i) in tracks" :key="track.id" class="track-row">
      <button
        type="button"
        class="btn-ghost track-play"
        :disabled="track.status !== 'ready'"
        :aria-label="playing === track.id ? `Stop “${mediaDisplayName(track)}”` : `Play “${mediaDisplayName(track)}”`"
        @click="listen(track)"
      >{{ playing === track.id ? '■' : '▶' }}</button>
      <div class="track-info">
        <template v-if="renaming?.id === track.id">
          <input
            ref="renameInput"
            v-model="renaming.value"
            class="track-name-input"
            :maxlength="LIMITS.mediaNameMax"
            :disabled="renaming.saving"
            aria-label="Track name"
            @keydown.enter.prevent="saveRename"
            @keydown.esc.stop="cancelRename"
            @blur="saveRename"
          />
          <div v-if="renaming.error" class="error-msg" style="font-size:12px">{{ renaming.error }}</div>
        </template>
        <div v-else class="track-name">{{ mediaDisplayName(track) }}</div>
        <div class="track-detail">
          <template v-if="track.duration != null">{{ length(track.duration) }} · </template>{{ track.filename ?? 'processing' }}
          <template v-if="track.error"> · {{ track.error }}</template>
        </div>
      </div>
      <span class="badge" :class="`badge--${track.status}`">{{ track.status }}</span>
      <div style="display:flex;gap:4px">
        <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :aria-label="`Rename “${mediaDisplayName(track)}”`" title="Rename" :disabled="renaming?.id === track.id" @click="startRename(track)">✎</button>
        <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :disabled="i === 0" @click="move(i, -1)">↑</button>
        <button class="btn-ghost" style="padding:4px 8px;font-size:12px" :disabled="i === tracks.length - 1" @click="move(i, 1)">↓</button>
        <button class="btn-danger" style="padding:4px 8px;font-size:12px" @click="remove(track)">✕</button>
      </div>
    </div>
  </CollapsibleCard>
</template>

<style scoped>
.track-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.track-row:last-child { border-bottom: none; }
.track-play { width: 36px; height: 36px; padding: 0; font-size: 14px; flex-shrink: 0; }
.track-info { flex: 1; min-width: 0; }
.track-name { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.track-name-input { width: 100%; font-size: 14px; padding: 3px 6px; }
.track-detail { font-size: 12px; color: var(--text-muted); word-break: break-all; }
</style>
