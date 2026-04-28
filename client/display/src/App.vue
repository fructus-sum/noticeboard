<script setup>
import { computed } from 'vue';
import { useSocket } from './composables/useSocket.js';
import SlideShow from './components/SlideShow.vue';
import WaitingScreen from './components/WaitingScreen.vue';

const { playlist, connected } = useSocket();
const hasSlides = computed(() => playlist.value.slides.length > 0);
</script>

<template>
  <div class="app">
    <SlideShow v-if="hasSlides" :slides="playlist.slides" />
    <WaitingScreen v-else :connected="connected" />
  </div>
</template>

<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app, .app { width: 100%; height: 100%; overflow: hidden; background: #000; }
</style>
