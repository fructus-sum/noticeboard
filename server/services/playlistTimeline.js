// server/services/playlistTimeline.js — the playlist every screen is playing, and when it started
//
// Responsibilities
//   The Server's side of "every screen in step" (SYSTEM_DESIGN §18.8). It holds the running timeline
//   (the slides and the Server's time they started at). A changed playlist takes effect when the
//   slide on at that moment ends (shared/slideTimeline.mjs boundaryAfter), so no slide is cut
//   short, and it's announced then, with startedAt = that moment: every screen switches together. With
//   nothing on air, a change takes effect at once. The same playlist offered again changes nothing;
//   going back to the running one before the switch cancels it. Injectable clock and timers, so it
//   can be tested.
//
// Provides
//   createPlaylistTimeline({ onSwitch, now, timers }) → {
//     offer(slides)   the playlist as it is now (e.g. after a change)
//     current()       → { slides, startedAt }: what every screen should be playing
//     stop()
//   }
//   onSwitch({ slides, startedAt }) is called whenever the running timeline changes
//
// Used by
//   realtime/displaySocket.js; server/test/playlistTimeline.test.js
//
// Uses
//   shared/slideTimeline.mjs (boundaryAfter)
//
// Change impact
//   startedAt is part of the playlist payload screens keep time to (SYSTEM_DESIGN §15: a key added).
const { boundaryAfter } = require('../../shared/slideTimeline.mjs');

function createPlaylistTimeline({ onSwitch = () => {}, now = () => Date.now(), timers = globalThis } = {}) {
  let running = { slides: [], startedAt: now(), sig: '[]' };
  let pending = null;   // { slides, sig }
  let timer = null;

  function switchTo(list, at) {
    running = { slides: list.slides, startedAt: at, sig: list.sig };
    pending = null;
    onSwitch({ slides: running.slides, startedAt: running.startedAt });
  }

  function offer(slides) {
    const sig = JSON.stringify(slides);
    if (pending && sig === pending.sig) return;
    if (sig === running.sig) {
      // Back to the playlist that's running: the switch isn't needed any more
      if (pending) {
        timers.clearTimeout(timer);
        timer = null;
        pending = null;
      }
      return;
    }
    const t = now();
    if (!running.slides.length) {
      timers.clearTimeout(timer);
      timer = null;
      switchTo({ slides, sig }, t);
      return;
    }
    const at = boundaryAfter(running.slides, running.startedAt, t);
    pending = { slides, sig };
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      if (pending) switchTo(pending, at);
    }, Math.max(0, at - t));
  }

  return {
    offer,
    current: () => ({ slides: running.slides, startedAt: running.startedAt }),
    stop() {
      timers.clearTimeout(timer);
      timer = null;
    },
  };
}

module.exports = { createPlaylistTimeline };
