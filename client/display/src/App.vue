<script setup>
// client/display/src/App.vue — the viewer: the slideshow, or the waiting screen, with the corner controls
//
// Responsibilities
//   Shows SlideShow while there are slides, else WaitingScreen (the logo, or why nothing shows),
//   on the background colour chosen in Settings (the CSS variable --nb-background);
//   the location pin (when turned on in Settings), the exit button (kiosk only, while someone
//   uses the mouse, keyboard or touchscreen) and the warning mark while the installer needs running
//   again; the background audio of the slideshow on screen (none while the waiting screen shows);
//   the nightly reload. ?kiosk=off (a screen that left
//   kiosk mode) makes it an ordinary page: no exit button, no nightly reload.
//
// Used by
//   main.js
//
// Uses
//   useSocket (playlist, connection, display settings, audio), useActivity, recovery.js
//   (startDailyReload), SlideShow, WaitingScreen, DeviceInfo, ExitKiosk, AdminWarning, BackgroundAudio
import { ref, computed } from 'vue';
import { useSocket } from './composables/useSocket.js';
import { useActivity } from './composables/useActivity.js';
import SlideShow from './components/SlideShow.vue';
import WaitingScreen from './components/WaitingScreen.vue';
import DeviceInfo from './components/DeviceInfo.vue';
import ExitKiosk from './components/ExitKiosk.vue';
import AdminWarning from './components/AdminWarning.vue';
import BackgroundAudio from './components/BackgroundAudio.vue';
import { startDailyReload } from './recovery.js';

const { playlist, connected, received, settings, audio } = useSocket();
const { active } = useActivity();
const hasSlides = computed(() => playlist.value.slides.length > 0);
// The slideshow of the slide on screen, for its background audio; none on the waiting screen
const onAir = ref(null);
const audioFor = computed(() => (hasSlides.value ? onAir.value : null));

// ?kiosk=off: this screen left kiosk mode (the kiosk script reopens the viewer like this in a
// normal window), so it's an ordinary web page now: no exit button, no nightly reload
const kiosk = new URLSearchParams(window.location.search).get('kiosk') !== 'off';
if (kiosk) startDailyReload(() => connected.value);
</script>

<template>
  <div class="app" :class="{ 'app--idle': !active }" :style="{ '--nb-background': settings.background }">
    <SlideShow v-if="hasSlides" :slides="playlist.slides" :connected="connected" @on-air="(folder) => { onAir = folder; }" />
    <WaitingScreen v-else :connected="connected" :received="received" :logo="settings.logo" />
    <DeviceInfo v-if="settings.showDeviceInfo" />
    <ExitKiosk v-if="kiosk" :visible="active" />
    <AdminWarning v-if="settings.installerNeeded || settings.updateAvailable" />
    <BackgroundAudio :audio="audio" :on-air="audioFor" />
  </div>
</template>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app, .app { width: 100%; height: 100%; overflow: hidden; background: #000; }
.app { background: var(--nb-background, #000); }

/* No cursor over the slideshow once the mouse has been still for a few seconds */
.app--idle, .app--idle * { cursor: none !important; }
</style>
