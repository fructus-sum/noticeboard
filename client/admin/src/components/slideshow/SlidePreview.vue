<script setup>
import { computed } from 'vue';
import { mediaUrl } from '@shared/index.js';

// A larger view of one slide, over the slide list. Hovering shows it while the pointer stays
// on the thumbnail; clicking or tapping pins it until closed (✕, Esc, or a click outside).
// It fits within 500 × 500 px keeping its shape, and is never enlarged beyond its own size.
const props = defineProps({
  slide: { type: Object, required: true },
  folder: { type: String, required: true },
  position: { type: Number, required: true },   // 1-based place in the slideshow
  pinned: Boolean,
});
defineEmits(['close']);

const media = (name) => (name ? mediaUrl(props.folder, name) : null);
const src = computed(() => media(props.slide.filename));
const thumb = computed(() => media(props.slide.thumbnail));
</script>

<template>
  <div class="overlay" :class="{ 'overlay--pinned': pinned }" @click.self="$emit('close')">
    <div class="box" role="dialog" :aria-modal="pinned ? 'true' : undefined" aria-label="Slide preview">
      <button v-if="pinned" type="button" class="close" aria-label="Close the preview" @click="$emit('close')">✕</button>
      <img v-if="slide.type === 'image' && src" :src="src" alt="" class="media" />
      <video
        v-else-if="slide.type === 'video' && src && pinned"
        :src="src"
        :poster="thumb ?? undefined"
        class="media"
        controls
        muted
        playsinline
        preload="metadata"
      />
      <img v-else-if="slide.type === 'video' && thumb" :src="thumb" alt="" class="media" />
      <div v-else class="none">No preview yet</div>
      <p class="caption">
        Slide {{ position }} · {{ slide.type }}
        <template v-if="slide.type === 'video' && !pinned"> · click to play</template>
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Hovering: a view that follows the pointer's thumbnail and never gets in the way */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  pointer-events: none;
}
/* Pinned: can be used (e.g. to play a video) and closed with a click outside */
.overlay--pinned { pointer-events: auto; background: rgba(15, 23, 42, 0.55); }

.box {
  position: relative;
  background: var(--surface);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
  max-width: calc(100vw - 32px);
}
.media {
  display: block;
  max-width: min(500px, calc(100vw - 56px));
  max-height: min(500px, calc(100vh - 110px));
  margin: 0 auto;
  background: #000;
}
.none {
  width: 240px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 4px;
}
.caption { margin-top: 8px; font-size: 12px; color: var(--text-muted); text-align: center; }
.close {
  position: absolute;
  top: -12px;
  right: -12px;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 14px;
}
.close:hover { background: var(--surface-2); }
</style>
