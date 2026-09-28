<script setup>
// client/display/src/components/BackgroundAudio.vue — the slideshow's background audio (no markup)
//
// Responsibilities
//   Plays the audio show of the slideshow on screen (SYSTEM_DESIGN §18.3) with the shared engine
//   (shared/audioPlayer.mjs): a new slideshow switches it at once with the new show's transition,
//   one without audio fades it out, and two slideshows on the same show carry on without a break.
//   While an event is on (audio.event), every screen plays that show instead, even with no
//   slideshow on; afterwards the slideshow's show carries on with its next track.
//   While a video plays its own sound, the background is lowered to its lowerTo % or paused, and
//   brought back (or resumed where it was) when that slide goes.
//   If the browser won't play sound (a kiosk whose installer hasn't been run again, or an ordinary
//   browser tab) it stays silent and tries again every minute, or at once when someone clicks, taps
//   or presses a key on the screen.
//
// Props
//   audio (the last audio:update: { shows, slideshows, event }), onAir (the slideshow of the slide on
//   screen, or null), videoSound (the video on screen's { withSound, lowerTo } while it plays its
//   own sound, else null)
//
// Used by: App.vue
// Uses: createAudioPlayer from @shared/audioPlayer.mjs
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { createAudioPlayer } from '@shared/audioPlayer.mjs';

const props = defineProps({
  audio: { type: Object, required: true },
  onAir: { type: String, default: null },
  videoSound: { type: Object, default: null },
});

const player = createAudioPlayer({ createElement: () => new Audio() });

// The event's show, else the one for the slideshow on screen; the engine ignores the same show sent again
const show = computed(() => {
  const folder = props.audio.event || (props.onAir ? props.audio.slideshows?.[props.onAir] : null);
  return (folder && props.audio.shows?.[folder]) || null;
});
watch(show, (s) => player.setShow(s), { immediate: true });

// A video with its own sound: lower or pause the background meanwhile
const DUCK_MS = 500;
watch(() => props.videoSound, (now, before) => {
  if (before?.withSound === 'pause' && now?.withSound !== 'pause') player.resume();
  if (now?.withSound === 'pause') player.pause();
  player.duck(now?.withSound === 'lower' ? now.lowerTo / 100 : 1, DUCK_MS);
}, { immediate: true });

// A click, tap or key press lets a browser play sound: try again straight away
const retry = () => player.retryNow();
onMounted(() => {
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, retry, true);
  // Read-only diagnostic, e.g. from remote DevTools: window.noticeboardAudio()
  window.noticeboardAudio = () => player.state();
});
onUnmounted(() => {
  for (const type of ['pointerdown', 'keydown']) window.removeEventListener(type, retry, true);
  delete window.noticeboardAudio;
  player.destroy();
});
</script>

<template>
  <!-- Nothing to show: the engine makes its own audio elements -->
  <span hidden />
</template>
