<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import ImageSlide from './ImageSlide.vue';
import VideoSlide from './VideoSlide.vue';

const props = defineProps({
  slides: { type: Array, required: true },
});

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
    // Single-slide loop: the index won't change, so Vue won't re-render.
    // Step to -1 (renders nothing) then back to 0 on the next tick to
    // force the slide component to remount and retry.
    currentIndex.value = -1;
    nextTick(() => { currentIndex.value = 0; });
  } else {
    currentIndex.value = next;
  }
}

function onImageReady() {
  clearTimer();
  // duration is in seconds; fall back to 10 s if null/undefined
  timer = setTimeout(advance, (currentSlide.value?.duration ?? 10) * 1000);
}

// When the playlist changes, restart from slide 0
watch(() => props.slides, () => {
  clearTimer();
  currentIndex.value = 0;
});

onUnmounted(clearTimer);
</script>

<template>
  <div class="slideshow">
    <Transition name="fade" mode="out-in">
      <ImageSlide
        v-if="currentSlide?.type === 'image'"
        :key="currentSlide.url"
        :src="currentSlide.url"
        :duration="currentSlide.duration"
        @ready="onImageReady"
        @error="advance"
      />
      <VideoSlide
        v-else-if="currentSlide?.type === 'video'"
        :key="currentSlide.url"
        :src="currentSlide.url"
        @ended="advance"
      />
    </Transition>
  </div>
</template>

<style scoped>
.slideshow {
  position: relative;
  width: 100%;
  height: 100%;
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
