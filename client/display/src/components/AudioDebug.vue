<script setup>
// client/display/src/components/AudioDebug.vue — what the audio is doing, on screen (?debug=audio)
//
// A read-only panel for checking sound on a real screen (SYSTEM_DESIGN §18.3 phase 8): the engine's
// state (show, track, playing, paused, blocked, the volume factor while a video plays its sound), each
// background audio element (its file, playing or not, volume, time), and the video on screen (aloud or
// muted, playing, time). Twice a second. Shown only with ?debug=audio in the viewer's address, e.g. in
// an ordinary window after leaving the kiosk; the slideshow carries on as usual.
//
// Used by: App.vue
// Uses: window.noticeboardAudio (BackgroundAudio)
import { ref, onMounted, onUnmounted } from 'vue';

const lines = ref([]);
let timer = null;
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');

function read() {
  const a = window.noticeboardAudio?.();
  const v = document.querySelector('video');
  lines.value = [
    a ? `engine: show ${a.show ?? '—'} · track ${a.track ?? '—'} · ${a.blocked ? 'BLOCKED (browser refused sound)' : a.playing ? 'playing' : a.paused ? 'paused' : 'stopped'} · volume factor ${f1(a.duck)}` : 'engine: not running',
    ...(a?.elements ?? []).map((e, i) => `audio ${i + 1}: ${e.src || '(none)'} · ${e.paused ? 'paused' : 'PLAYING'} · volume ${e.volume.toFixed(2)} · ${f1(e.time)} s`),
    v ? `video: ${v.muted ? 'muted' : 'ALOUD'} · ${v.paused ? 'paused' : 'playing'} · volume ${v.volume.toFixed(2)} · ${f1(v.currentTime)} s` : 'video: none on screen',
  ];
}

onMounted(() => { read(); timer = setInterval(read, 500); });
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="audio-debug" aria-hidden="true">
    <div v-for="(line, i) in lines" :key="i">{{ line }}</div>
  </div>
</template>

<style scoped>
.audio-debug {
  position: fixed;
  left: 8px;
  bottom: 8px;
  z-index: 50;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #e5e7eb;
  font: 12px/1.5 monospace;
  pointer-events: none;
}
</style>
