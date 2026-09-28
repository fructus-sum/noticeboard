// client/admin/src/composables/useShowActions.js — publishing (and hiding) a slideshow or an audio show
//
// Provides
//   useShowActions(base = '/slideshows') → {   base: '/slideshows' or '/audioshows'
//     toggling, hiding              the folder being published/disabled or hidden/unhidden (or null),
//                                   for disabling its buttons meanwhile
//     setEnabled(folder, enabled)   → the saved show, or null (the error was shown)
//     setHidden(folder, hidden)     → the saved show, or null (slideshows only)
//   }
//   The server's rules apply (only an unpublished slideshow can be hidden); its message is shown
//   in an alert, as it always has been.
//
// Used by: SlideshowsView, slideshow/SlideshowSettingsCard, AudioShowsView, audio/AudioShowSettingsCard
// Uses: useApi (PUT <base>/:folder)
import { ref } from 'vue';
import { api } from './useApi.js';

export function useShowActions(base = '/slideshows') {
  const toggling = ref(null);
  const hiding = ref(null);

  async function change(state, folder, patch) {
    state.value = folder;
    try {
      return await api.put(`${base}/${folder}`, patch);
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
