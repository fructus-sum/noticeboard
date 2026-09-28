// client/admin/src/composables/useFlash.js — a short message after an action ("Saved.", or what went wrong)
//
// Provides
//   useFlash() → a reactive { text, tone, ok(text, clearAfterMs?), error(text), clear() }
//     ok       a success (green); with clearAfterMs it clears itself after that long
//     error    a failure (red); stays until it's dismissed (FlashMessage's ✕) or the next message
//              (the result of the next attempt) replaces it
//     clear()  no message
//   Every new message, and clear(), cancels the previous message's timer, so an earlier "Saved."
//   can never clear a later message (SYSTEM_DESIGN §18.5 item 11). FlashMessage.vue shows it.
//
// Used by: the Settings cards (display, MAC filtering, port, branding, password, delete content),
//   updates/UpdateSchedule, the slideshow and audio show settings cards, the event audio card
import { reactive } from 'vue';

export function useFlash() {
  let timer = null;
  const stopTimer = () => {
    clearTimeout(timer);
    timer = null;
  };
  const flash = reactive({
    text: '',
    tone: 'ok',
    ok(text, clearAfterMs) {
      stopTimer();
      flash.text = text;
      flash.tone = 'ok';
      if (clearAfterMs) timer = setTimeout(() => { timer = null; flash.text = ''; }, clearAfterMs);
    },
    error(text) {
      stopTimer();
      flash.text = text;
      flash.tone = 'error';
    },
    clear() {
      stopTimer();
      flash.text = '';
    },
  });
  return flash;
}
