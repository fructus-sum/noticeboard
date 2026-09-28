// client/admin/src/composables/useCollapsed.js — which admin cards are folded away to their title
//
// Remembered in this browser (localStorage noticeboard:collapsedCards: a JSON list of card names),
// shared by every card. Storage that can't be read or written just means every card starts open.
// Provides: useCollapsed(name) → { collapsed (computed, settable) }
// Used by: components/ui/CollapsibleCard
import { ref, computed, watch } from 'vue';

const KEY = 'noticeboard:collapsedCards';

function initial() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(saved)) return saved.filter((n) => typeof n === 'string');
  } catch {
    // Storage unavailable or unreadable: every card open
  }
  return [];
}

const folded = ref(initial());
watch(folded, (names) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    // Not remembered, but it still works for this visit
  }
});

export function useCollapsed(name) {
  const collapsed = computed({
    get: () => folded.value.includes(name),
    set: (value) => {
      const others = folded.value.filter((n) => n !== name);
      folded.value = value ? [...others, name] : others;
    },
  });
  return { collapsed };
}
