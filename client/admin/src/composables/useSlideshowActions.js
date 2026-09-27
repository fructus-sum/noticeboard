// client/admin/src/composables/useSlideshowActions.js — publishing and hiding a slideshow
//
// Provides
//   useSlideshowActions() → {
//     toggling, hiding              the folder being published/disabled or hidden/unhidden (or null),
//                                   for disabling its buttons meanwhile
//     setEnabled(folder, enabled)   → the saved slideshow, or null (the error was shown)
//     setHidden(folder, hidden)     → the saved slideshow, or null
//   }
//   The server's rules apply (only an unpublished slideshow can be hidden); its message is shown
//   in an alert, as it always has been.
//
// Used by: SlideshowsView (and the slideshow page's settings card)
import { ref } from 'vue';
import { api } from './useApi.js';

export function useSlideshowActions() {
  const toggling = ref(null);
  const hiding = ref(null);

  async function change(state, folder, patch) {
    state.value = folder;
    try {
      return await api.put(`/slideshows/${folder}`, patch);
    } catch (e) {
      alert(e.message);
      return null;
    } finally {
      state.value = null;
    }
  }

  return {
    toggling,
    hiding,
    setEnabled: (folder, enabled) => change(toggling, folder, { enabled }),
    setHidden: (folder, hidden) => change(hiding, folder, { hidden }),
  };
}
