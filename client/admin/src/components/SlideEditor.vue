<script setup>
/**
 * SlideEditor — modal for adding/editing text overlays on slides, and for
 * creating brand-new blank text slides.
 *
 * Props:
 *   folder  — slideshow folder name
 *   slide   — existing slide object to edit (null when creating a text slide)
 *
 * Emits:
 *   saved(updatedSlide)  — after a successful PUT /:id
 *   created(newSlide)    — after a successful POST /text
 *   close                — user dismissed the modal
 */
import { ref, reactive, computed, watch } from 'vue';
import { api } from '../composables/useApi.js';

const props = defineProps({
  folder: { type: String, required: true },
  slide:  { type: Object, default: null },   // null → create text slide mode
});

const emit = defineEmits(['saved', 'created', 'close']);

const FONTS = [
  { label: 'Sans-serif',    value: 'sans-serif' },
  { label: 'Serif',         value: 'serif' },
  { label: 'Monospace',     value: 'monospace' },
  { label: 'Arial',         value: 'Arial, sans-serif' },
  { label: 'Georgia',       value: 'Georgia, serif' },
  { label: 'Impact',        value: 'Impact, sans-serif' },
  { label: 'Trebuchet MS',  value: "'Trebuchet MS', sans-serif" },
];

// Determine if we're editing an overlay on an existing slide, or creating a blank text slide
const isCreating = computed(() => !props.slide);

// Form state — initialised from existing slide data or sensible defaults
const form = reactive({
  // overlay fields
  text:       '',
  fontFamily: 'sans-serif',
  fontSize:   60,
  color:      '#ffffff',
  overlayBg:  false,
  overlayBgColor: 'rgba(0,0,0,0.45)',
  x:          50,
  y:          85,
  align:      'center',
  // text-slide fields
  bgColor:    '#1e293b',
  duration:   10,
  // clear overlay toggle (only for editing existing overlaid slides)
  clearOverlay: false,
});

function initForm() {
  if (props.slide) {
    const ov = props.slide.overlay;
    if (ov) {
      form.text       = ov.text       ?? '';
      form.fontFamily = ov.fontFamily ?? 'sans-serif';
      form.fontSize   = ov.fontSize   ?? 60;
      form.color      = ov.color      ?? '#ffffff';
      form.overlayBg  = !!(ov.bgColor && ov.bgColor !== 'transparent');
      form.overlayBgColor = ov.bgColor && ov.bgColor !== 'transparent' ? ov.bgColor : 'rgba(0,0,0,0.45)';
      form.x          = ov.x          ?? 50;
      form.y          = ov.y          ?? 85;
      form.align      = ov.align      ?? 'center';
    } else {
      // existing slide with no overlay — reset to defaults
      form.text = '';
      form.fontFamily = 'sans-serif';
      form.fontSize = 60;
      form.color = '#ffffff';
      form.overlayBg = false;
      form.overlayBgColor = 'rgba(0,0,0,0.45)';
      form.x = 50;
      form.y = 85;
      form.align = 'center';
    }
    form.bgColor = props.slide.bgColor ?? '#1e293b';
    form.duration = props.slide.duration ?? 10;
    form.clearOverlay = false;
  } else {
    // Creating a new blank text slide — reset all
    form.text = '';
    form.fontFamily = 'sans-serif';
    form.fontSize = 72;
    form.color = '#f1f5f9';
    form.overlayBg = false;
    form.overlayBgColor = 'rgba(0,0,0,0.45)';
    form.x = 50;
    form.y = 50;
    form.align = 'center';
    form.bgColor = '#1e293b';
    form.duration = 10;
    form.clearOverlay = false;
  }
}

// Re-init whenever the target slide changes
watch(() => props.slide, initForm, { immediate: true });

// Derived overlay object for preview and submission
const overlayObj = computed(() => ({
  text:       form.text,
  fontFamily: form.fontFamily,
  fontSize:   form.fontSize,
  color:      form.color,
  bgColor:    form.overlayBg ? form.overlayBgColor : null,
  x:          form.x,
  y:          form.y,
  align:      form.align,
}));

const saving = ref(false);
const errorMsg = ref('');

async function save() {
  errorMsg.value = '';
  if (!form.clearOverlay && !form.text.trim()) {
    errorMsg.value = 'Text cannot be empty.';
    return;
  }

  saving.value = true;
  try {
    if (isCreating.value) {
      // POST /text — create blank text slide
      const newSlide = await api.post(`/slideshows/${props.folder}/slides/text`, {
        overlay:  overlayObj.value,
        bgColor:  form.bgColor,
        duration: Number(form.duration),
      });
      emit('created', newSlide);
    } else {
      // PUT /:id — update existing slide
      const body = form.clearOverlay
        ? { overlay: null }
        : { overlay: overlayObj.value };
      const updated = await api.put(`/slideshows/${props.folder}/slides/${props.slide.id}`, body);
      emit('saved', updated);
    }
  } catch (e) {
    errorMsg.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2 style="margin:0;font-size:16px">
          {{ isCreating ? 'New Text Slide' : (slide?.overlay ? 'Edit Overlay' : 'Add Overlay') }}
        </h2>
        <button class="btn-ghost" style="padding:4px 10px;font-size:14px" @click="emit('close')">✕</button>
      </div>

      <!-- Live preview -->
      <div class="preview-wrap">
        <div
          class="preview"
          :style="{ background: isCreating ? form.bgColor : '#444' }"
        >
          <img
            v-if="!isCreating && slide?.type === 'image' && slide?.filename"
            :src="`/media/${folder}/slides/${slide.filename}`"
            class="preview-img"
          />
          <div
            v-if="!form.clearOverlay && form.text"
            class="preview-overlay"
            :style="{
              left:       form.x + '%',
              top:        form.y + '%',
              fontFamily: form.fontFamily,
              fontSize:   (form.fontSize * 0.25) + 'px',
              color:      form.color,
              textAlign:  form.align,
              background: form.overlayBg ? form.overlayBgColor : 'transparent',
            }"
          >{{ form.text }}</div>
        </div>
        <p style="text-align:center;font-size:11px;color:var(--text-muted);margin:4px 0 0">Live preview (scaled)</p>
      </div>

      <form @submit.prevent="save" class="editor-form">

        <!-- Clear overlay toggle (only when editing a slide that already has one) -->
        <div v-if="!isCreating && slide?.overlay" style="margin-bottom:12px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <input type="checkbox" v-model="form.clearOverlay" style="width:auto" />
            Remove overlay from this slide
          </label>
        </div>

        <template v-if="!form.clearOverlay">
          <!-- Text -->
          <div class="field">
            <label>Text</label>
            <textarea v-model="form.text" rows="3" placeholder="Your message here…" style="resize:vertical" />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <!-- Font family -->
            <div class="field">
              <label>Font</label>
              <select v-model="form.fontFamily">
                <option v-for="f in FONTS" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </div>
            <!-- Alignment -->
            <div class="field">
              <label>Alignment</label>
              <div style="display:flex;gap:6px;margin-top:4px">
                <button
                  v-for="a in ['left','center','right']" :key="a"
                  type="button"
                  :class="['btn-ghost', form.align === a ? 'btn-ghost--active' : '']"
                  style="flex:1;padding:5px 0;font-size:12px;text-transform:capitalize"
                  @click="form.align = a"
                >{{ a }}</button>
              </div>
            </div>
          </div>

          <!-- Font size -->
          <div class="field">
            <label>Font size — {{ form.fontSize }}px</label>
            <input type="range" v-model.number="form.fontSize" min="12" max="200" />
          </div>

          <!-- Text color -->
          <div class="field">
            <label>Text color</label>
            <div style="display:flex;align-items:center;gap:10px">
              <input type="color" v-model="form.color" style="width:48px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border);cursor:pointer" />
              <span style="font-size:12px;color:var(--text-muted)">{{ form.color }}</span>
            </div>
          </div>

          <!-- Text background -->
          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" v-model="form.overlayBg" style="width:auto" />
              Text background (pill/box)
            </label>
            <div v-if="form.overlayBg" style="display:flex;align-items:center;gap:10px;margin-top:6px">
              <input type="color" v-model="form.overlayBgColor" style="width:48px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border);cursor:pointer" />
              <span style="font-size:12px;color:var(--text-muted)">{{ form.overlayBgColor }}</span>
            </div>
          </div>

          <!-- Position -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field">
              <label>Horizontal position — {{ form.x }}%</label>
              <input type="range" v-model.number="form.x" min="0" max="100" />
            </div>
            <div class="field">
              <label>Vertical position — {{ form.y }}%</label>
              <input type="range" v-model.number="form.y" min="0" max="100" />
            </div>
          </div>
        </template>

        <!-- Slide background & duration (text slide creation or text slides being edited) -->
        <template v-if="isCreating || slide?.type === 'text'">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field">
              <label>Slide background color</label>
              <div style="display:flex;align-items:center;gap:10px">
                <input type="color" v-model="form.bgColor" style="width:48px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border);cursor:pointer" />
                <span style="font-size:12px;color:var(--text-muted)">{{ form.bgColor }}</span>
              </div>
            </div>
            <div class="field">
              <label>Duration (seconds)</label>
              <input type="number" v-model.number="form.duration" min="1" max="300" />
            </div>
          </div>
        </template>

        <div style="display:flex;gap:10px;align-items:center;margin-top:4px">
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : (isCreating ? 'Create slide' : 'Save') }}
          </button>
          <button type="button" class="btn-ghost" @click="emit('close')">Cancel</button>
          <span v-if="errorMsg" class="error-msg">{{ errorMsg }}</span>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal {
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.preview-wrap {
  padding: 16px 20px 0;
}

.preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.preview-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-overlay {
  position: absolute;
  transform: translate(-50%, -50%);
  white-space: pre-wrap;
  padding: 2px 5px;
  border-radius: 4px;
  pointer-events: none;
  max-width: 80%;
  word-break: break-word;
  line-height: 1.3;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.editor-form {
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btn-ghost--active {
  background: var(--surface-2);
  color: var(--text);
  font-weight: 600;
}
</style>
