<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import ImageSlide from './ImageSlide.vue';
import VideoSlide from './VideoSlide.vue';
import TextSlide  from './TextSlide.vue';

const props = defineProps({
  slides: { type: Array, required: true },
});

const REFERENCE_WIDTH = 1920;
const slideshowEl = ref(null);
let resizeObs = null;

const currentIndex = ref(0);
const currentSlide = computed(() => props.slides[currentIndex.value] ?? null);

let timer = null;

function clearTimer() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
}

function advance() {
  clearTimer();
  const next = (currentIndex.value + 1) % props.slides.length;
  if (next === currentIndex.value) {
    // Single-slide loop: step to -1 then back to 0 on next tick to force remount.
    currentIndex.value = -1;
    nextTick(() => { currentIndex.value = 0; });
  } else {
    currentIndex.value = next;
  }
}

function onImageReady() {
  clearTimer();
  timer = setTimeout(advance, (currentSlide.value?.duration ?? 10) * 1000);
}

// When the playlist changes, restart from slide 0
watch(() => props.slides, () => {
  clearTimer();
  currentIndex.value = 0;
});

onMounted(() => {
  resizeObs = new ResizeObserver(([entry]) => {
    slideshowEl.value?.style.setProperty('--slide-scale', entry.contentRect.width / REFERENCE_WIDTH);
  });
  resizeObs.observe(slideshowEl.value);
});

onUnmounted(() => { clearTimer(); resizeObs?.disconnect(); });
</script>

<template>
  <div class="slideshow" ref="slideshowEl">
    <Transition name="fade" mode="out-in">
      <ImageSlide
        v-if="currentSlide?.type === 'image'"
        :key="currentSlide.url"
        :src="currentSlide.url"
        :duration="currentSlide.duration"
        :overlay="currentSlide.overlay"
        :watermark="currentSlide.watermark"
        @ready="onImageReady"
        @error="advance"
      />
      <VideoSlide
        v-else-if="currentSlide?.type === 'video'"
        :key="currentSlide.url"
        :src="currentSlide.url"
        :overlay="currentSlide.overlay"
        :watermark="currentSlide.watermark"
        @ended="advance"
      />
      <TextSlide
        v-else-if="currentSlide?.type === 'text'"
        :key="currentSlide.slideshow + '-' + currentIndex"
        :bgColor="currentSlide.bgColor"
        :overlay="currentSlide.overlay"
        :watermark="currentSlide.watermark"
        :duration="currentSlide.duration"
        @ready="onImageReady"
      />
    </Transition>
  </div>
</template>

<style scoped>
.slideshow {
  position: relative;
  width: min(100vw, calc(100vh * 16 / 9));
  height: min(100vh, calc(100vw * 9 / 16));
  background: #000;
  overflow: hidden;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
