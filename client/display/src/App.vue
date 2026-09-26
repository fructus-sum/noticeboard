<script setup>
import { computed } from 'vue';
import { useSocket } from './composables/useSocket.js';
import { useActivity } from './composables/useActivity.js';
import SlideShow from './components/SlideShow.vue';
import WaitingScreen from './components/WaitingScreen.vue';
import DeviceInfo from './components/DeviceInfo.vue';
import ExitKiosk from './components/ExitKiosk.vue';
import { startDailyReload } from './recovery.js';

const { playlist, connected, received } = useSocket();
const { active } = useActivity();
const hasSlides = computed(() => playlist.value.slides.length > 0);

// ?kiosk=off: this screen left kiosk mode (the kiosk script reopens the viewer like this in a
// normal window), so it's an ordinary web page now: no exit button, no nightly reload
const kiosk = new URLSearchParams(window.location.search).get('kiosk') !== 'off';
if (kiosk) startDailyReload(() => connected.value);
</script>

<template>
  <div class="app">
    <SlideShow v-if="hasSlides" :slides="playlist.slides" :connected="connected" />
    <WaitingScreen v-else :connected="connected" :received="received" />
    <DeviceInfo />
    <ExitKiosk v-if="kiosk" :visible="active" />
  </div>
</template>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app, .app { width: 100%; height: 100%; overflow: hidden; background: #000; }
</style>
