<script setup>
import ImageSlide from './ImageSlide.vue';
import VideoSlide from './VideoSlide.vue';

// One slide on screen. Every event carries this slide's generation, so a late event from a
// slide that is already fading out can't be mistaken for the slide that replaced it.
defineProps({
  slide: { type: Object, required: true },
  generation: { type: Number, required: true },
});
const emit = defineEmits(['ready', 'progress', 'ended', 'failed']);
</script>

<template>
  <ImageSlide
    v-if="slide.type === 'image'"
    :src="slide.url"
    :duration="slide.duration"
    @ready="emit('ready', generation)"
    @error="emit('failed', generation)"
  />
  <VideoSlide
    v-else-if="slide.type === 'video'"
    :src="slide.url"
    @ready="emit('ready', generation)"
    @progress="emit('progress', generation)"
    @ended="emit('ended', generation)"
    @error="emit('failed', generation)"
  />
</template>
