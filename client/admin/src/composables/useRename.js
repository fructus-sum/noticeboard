// client/admin/src/composables/useRename.js — renaming one item of a list in place (slides, tracks)
//
// One item at a time: ✎ opens a field with its current name selected, Enter or leaving the field
// saves, Esc cancels; an empty name removes the item's own name, so it goes back to the uploaded
// file's name (SYSTEM_DESIGN §14 D38). Nothing is sent when the name didn't change.
// Provides: useRename({ items, path }) → { renaming, renameInput, startRename(item), cancelRename(),
//   saveRename() }. `items` is the list (a ref, replaced with the saved item); `path(item)` is the
//   item's API path (PATCH { name }). renaming is { id, value, saving, error } or null; renameInput is
//   the template ref of the field (inside a v-for, so an array).
// Used by: components/slideshow/SlideList
// Uses: useApi
import { ref, nextTick } from 'vue';
import { api } from './useApi.js';

export function useRename({ items, path }) {
  const renaming = ref(null);   // { id, value, saving, error }
  const renameInput = ref(null);

  async function startRename(item) {
    renaming.value = { id: item.id, value: item.name || item.originalName || '', saving: false, error: '' };
    await nextTick();
    renameInput.value?.[0]?.select();
  }

  function cancelRename() {
    renaming.value = null;
  }

  async function saveRename() {
    const r = renaming.value;
    if (!r || r.saving) return;
    const item = items.value.find(s => s.id === r.id);
    if (!item) return cancelRename();
    const name = r.value.trim();
    if (name === (item.name || item.originalName || '') || (!name && !item.name)) return cancelRename();
    r.saving = true;
    try {
      const saved = await api.patch(path(item), { name });
      items.value = items.value.map(s => (s.id === saved.id ? saved : s));
      renaming.value = null;
    } catch (e) {
      r.saving = false;
      r.error = e.message;
    }
  }

  return { renaming, renameInput, startRename, cancelRename, saveRename };
}
