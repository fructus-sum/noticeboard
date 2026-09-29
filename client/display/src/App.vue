<script setup>
// client/display/src/App.vue — the viewer: the slideshow, or the waiting screen, with the corner controls
//
// Responsibilities
//   Shows SlideShow while there are slides, else WaitingScreen (the logo, or why nothing shows),
//   on the background colour chosen in Settings (the CSS variable --nb-background);
//   the location pin (when turned on in Settings), the exit button (kiosk only, while someone
//   uses the mouse, keyboard or touchscreen) and the warning mark while the installer needs running
//   again; the background audio of the slideshow on screen (none while the waiting screen shows),
//   lowered or paused while a video plays its own sound;
//   the nightly reload. ?kiosk=off (a screen that left
//   kiosk mode) makes it an ordinary page: no exit button, no nightly reload; ?kiosk=headless (a
//   Client without a desktop) keeps kiosk mode without the exit button.
//
// Used by
//   main.js
//
// Uses
//   useSocket (playlist, connection, display settings, audio), useActivity, recovery.js
//   (startDailyReload), SlideShow, WaitingScreen, DeviceInfo, ExitKiosk, AdminWarning, BackgroundAudio,
//   AudioDebug (?debug=audio)
import { ref, computed } from 'vue';
import { useSocket } from './composables/useSocket.js';
import { useActivity } from './composables/useActivity.js';
import SlideShow from './components/SlideShow.vue';
import WaitingScreen from './components/WaitingScreen.vue';
import DeviceInfo from './components/DeviceInfo.vue';
import ExitKiosk from './components/ExitKiosk.vue';
import AdminWarning from './components/AdminWarning.vue';
import BackgroundAudio from './components/BackgroundAudio.vue';
import AudioDebug from './components/AudioDebug.vue';
import { startDailyReload } from './recovery.js';

const { playlist, connected, received, settings, audio, serverNow } = useSocket();
const { active } = useActivity();
const hasSlides = computed(() => playlist.value.slides.length > 0);
// The slide on screen, for the background audio: its slideshow's show, and a video's own sound
const onAir = ref(null);
const audioFor = computed(() => (hasSlides.value ? onAir.value?.slideshow ?? null : null));
const videoSound = computed(() => {
  const s = hasSlides.value ? onAir.value : null;
  return s?.type === 'video' && s.sound === true ? { withSound: s.withSound, lowerTo: s.lowerTo } : null;
});

// ?kiosk=off: this screen left kiosk mode (the kiosk script reopens the viewer like this in a
// normal window), so it's an ordinary web page now: no exit button, no nightly reload.
// ?kiosk=headless: a Client without a desktop (cage, SYSTEM_DESIGN §18.7): kiosk mode, but no exit
// button, as there's no desktop to go to
const kioskParam = new URLSearchParams(window.location.search).get('kiosk');
const kiosk = kioskParam !== 'off';
const exitButton = kiosk && kioskParam !== 'headless';
// ?debug=audio: what the audio is doing, on screen (AudioDebug)
const audioDebug = new URLSearchParams(window.location.search).get('debug') === 'audio';
if (kiosk) startDailyReload(() => connected.value);
</script>

<template>
  <div class="app" :class="{ 'app--idle': !active }" :style="{ '--nb-background': settings.background }">
    <SlideShow v-if="hasSlides" :slides="playlist.slides" :started-at="playlist.startedAt ?? null" :server-now="serverNow" :connected="connected" @on-air="(slide) => { onAir = slide; }" />
    <WaitingScreen v-else :connected="connected" :received="received" :logo="settings.logo" />
    <DeviceInfo v-if="settings.showDeviceInfo" />
    <ExitKiosk v-if="exitButton" :visible="active" />
    <AdminWarning v-if="settings.installerNeeded || settings.updateAvailable || settings.restartNeeded" />
    <BackgroundAudio :audio="audio" :on-air="audioFor" :video-sound="videoSound" :server-now="serverNow" />
    <AudioDebug v-if="audioDebug" />
  </div>
</template>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app, .app { width: 100%; height: 100%; overflow: hidden; background: #000; }
.app { background: var(--nb-background, #000); }

/* No cursor over the slideshow once the mouse has been still for a few seconds */
.app--idle, .app--idle * { cursor: none !important; }
</style>
