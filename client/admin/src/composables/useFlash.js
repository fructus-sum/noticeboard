// client/admin/src/composables/useFlash.js — a short message after an action ("Saved.", or what went wrong)
//
// Provides
//   useFlash() → a reactive { text, tone, ok(text, clearAfterMs?), error(text), clear() }
//     ok       a success (green); with clearAfterMs it clears itself after that long
//     error    a failure (red); stays until the next message or clear()
//   FlashMessage.vue shows it.
//
// Used by: the Settings cards (display, MAC filtering, logo, password), the slideshow settings card
import { reactive } from 'vue';

export function useFlash() {
  const flash = reactive({
    text: '',
    tone: 'ok',
    ok(text, clearAfterMs) {
      flash.text = text;
      flash.tone = 'ok';
      // Clears whatever is shown by then, as the pages always did
      if (clearAfterMs) setTimeout(() => { flash.text = ''; }, clearAfterMs);
    },
    error(text) {
      flash.text = text;
      flash.tone = 'error';
    },
    clear() {
      flash.text = '';
    },
  });
  return flash;
}
