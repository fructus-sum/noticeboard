<script setup>
// client/admin/src/components/ui/CollapsibleCard.vue — a section card that folds away to its title
//
// The title stays; clicking it (or its ▾) folds the card or opens it again, and the card remembers
// that in this browser (useCollapsed). While `attention` is true (the card holds a warning or an
// error) it is shown open and can't be folded, so folding never hides a warning (SYSTEM_DESIGN
// §14 D39). The body stays mounted while folded, so a form being filled in or a list being polled
// carries on.
//
// The ▾ is drawn by CSS, so the title's text is exactly the title (tests and the page text rely on it).
// Props: title, name (the key it's remembered by), attention
// Slots: default (the body), actions (buttons beside the title, e.g. Edit; hidden while folded)
// Attributes (e.g. an id to link to) go to the card.
// Used by: settings/DisplaySettingsCard, MacFilterCard, BrandingSettings, PasswordCard,
//          DeleteContentCard, updates/SoftwareUpdates, slideshow/SlideshowSettingsCard, SlideList
// Uses: useCollapsed
import { computed, useId } from 'vue';
import { useCollapsed } from '../../composables/useCollapsed.js';

const props = defineProps({
  title: { type: String, required: true },
  name: { type: String, required: true },
  attention: Boolean,
});

const { collapsed: folded } = useCollapsed(props.name);
const collapsed = computed(() => folded.value && !props.attention);
const bodyId = `card-body-${useId()}`;

function toggle() {
  if (props.attention) return;
  folded.value = !folded.value;
}
</script>

<template>
  <section class="card" :class="{ 'card--collapsed': collapsed }">
    <div class="card-head">
      <h2 class="card-title">
        <button
          type="button"
          class="card-toggle"
          :aria-expanded="collapsed ? 'false' : 'true'"
          :aria-controls="bodyId"
          :aria-disabled="attention ? 'true' : undefined"
          :title="attention ? 'Open while it needs attention' : collapsed ? 'Show' : 'Hide'"
          @click="toggle"
        >
          {{ title }}
        </button>
      </h2>
      <div v-if="$slots.actions && !collapsed" class="card-actions"><slot name="actions" /></div>
    </div>
    <div v-show="!collapsed" :id="bodyId" class="card-body"><slot /></div>
  </section>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.card--collapsed .card-head { margin-bottom: 0; }
.card-title { display: flex; flex: 1 1 auto; min-width: 0; margin: 0; font-size: 1.1rem; font-weight: 600; }
/* The title itself is the button: it keeps the heading's font and line height */
.card-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  line-height: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.card-toggle[aria-disabled='true'] { cursor: default; }
.card-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 2px; }
.card-toggle::before {
  content: '▾';
  display: inline-block;
  font-size: 0.95em;
  line-height: 1;
  color: var(--text-muted);
  transition: transform 0.15s;
}
.card--collapsed .card-toggle::before { transform: rotate(-90deg); }
.card-toggle[aria-disabled='true']::before { visibility: hidden; }
.card-actions { display: flex; gap: 8px; align-items: center; }
</style>
