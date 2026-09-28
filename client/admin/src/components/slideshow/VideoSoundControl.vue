<script setup>
// client/admin/src/components/slideshow/VideoSoundControl.vue — a video's own sound, in the slide list
//
// Responsibilities
//   The Sound switch of one video, and while it's on, what the slideshow's background audio does
//   meanwhile: lowered to a volume (%) or paused (SYSTEM_DESIGN §18.3). Every change is saved at once
//   (PUT …/slides/:id/sound), like a rename; an error shows under it.
//
// Props: folder, slide (a video). Emits: change(slide), the slide as saved.
// Used by: slideshow/SlideList
// Uses: useApi; AUDIO from @shared (the choices and the volume's range)
import { ref } from 'vue';
import { AUDIO } from '@shared/index.js';
import { api } from '../../composables/useApi.js';

const props = defineProps({
  folder: { type: String, required: true },
  slide: { type: Object, required: true },
});
const emit = defineEmits(['change']);

const saving = ref(false);
const error = ref('');
const lowerTo = ref(props.slide.lowerTo ?? AUDIO.lowerTo.default);

async function save(body) {
  saving.value = true;
  error.value = '';
  try {
    emit('change', await api.put(`/slideshows/${props.folder}/slides/${props.slide.id}/sound`, body));
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

const setSound = (on) => save(on ? { sound: true, withSound: props.slide.withSound, lowerTo: lowerTo.value } : { sound: false });
const setWithSound = (withSound) => save({ sound: true, withSound, lowerTo: props.slide.lowerTo ?? lowerTo.value });
function setLowerTo() {
  const n = Number(lowerTo.value);
  if (Number.isInteger(n) && n !== props.slide.lowerTo) save({ sound: true, withSound: props.slide.withSound, lowerTo: n });
}
</script>

<template>
  <div class="video-sound">
    <label class="video-sound__switch">
      <input type="checkbox" :checked="slide.sound === true" :disabled="saving" @change="setSound($event.target.checked)" />
      Sound
    </label>
    <template v-if="slide.sound === true">
      <span class="video-sound__meanwhile">background audio meanwhile:</span>
      <select :value="slide.withSound" :disabled="saving" aria-label="Background audio while it plays" @change="setWithSound($event.target.value)">
        <option value="lower">lowered to</option>
        <option value="pause">paused</option>
      </select>
      <template v-if="slide.withSound === 'lower'">
        <input
          v-model.number="lowerTo"
          type="number"
          :min="AUDIO.lowerTo.min"
          :max="AUDIO.lowerTo.max"
          :disabled="saving"
          aria-label="Background audio volume while it plays (%)"
          class="video-sound__volume"
          @change="setLowerTo"
        /> %
      </template>
    </template>
    <div v-if="error" class="error-msg" style="font-size:12px;width:100%">{{ error }}</div>
  </div>
</template>

<style scoped>
.video-sound { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin-top: 4px; font-size: 12px; }
.video-sound__switch { display: inline-flex; align-items: center; gap: 4px; margin: 0; font-weight: 500; color: var(--text); }
.video-sound__switch input { width: auto; }
.video-sound__meanwhile { color: var(--text-muted); }
.video-sound select { width: auto; font-size: 12px; padding: 2px 4px; }
.video-sound__volume { width: 64px; font-size: 12px; padding: 2px 4px; }
</style>
