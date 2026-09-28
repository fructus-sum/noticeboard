// client/display/src/slideshowClock.js — decides when the display moves on to the next slide
//
// Built for screens that run unattended for months: every slide has a deadline, and a watchdog
// moves on whenever that deadline passes, whatever the reason (a lost timer, an image that never
// loads, a video that stalls, a page that was hidden, frozen or asleep). Plain JavaScript with
// injectable timers, so the behaviour can be tested over simulated weeks.
//
// A video whose length the playlist gives (length, in seconds) keeps its place for that long even
// if it can't be played (e.g. a format this screen can't decode) or stops: the slideshow moves on
// when it ends, or at its expected end, never earlier (SYSTEM_DESIGN §3.5). A video without a
// length (from an older server) is skipped when it fails or stalls, as before.
//
// Provides
//   createSlideshowClock({ onChange, onStuck, now, timers }) → a clock: it calls onChange({ index,
//   generation }) to show a slide, and onStuck after three whole rounds fail; the slide's events
//   (ready, progress, ended, failed) and a playlist come in through its methods
//   The timing constants (LOAD_TIMEOUT_MS, STALL_TIMEOUT_MS, GRACE_MS, RETRY_MS, OUTAGE_RETRY_MS,
//   WATCHDOG_MS)
//
// Used by
//   components/SlideShow.vue; client/display/test/slideshowClock.test.mjs
//
// Change impact
//   All of the viewer's timing is here: change it with the tests (npm test), which simulate 30 days.
export const LOAD_TIMEOUT_MS = 30_000;   // a slide that hasn't appeared by then is skipped
export const STALL_TIMEOUT_MS = 30_000;  // a video that makes no progress for this long is skipped
export const GRACE_MS = 5_000;           // watchdog slack on top of an image's own timer
export const RETRY_MS = 2_000;           // pause before the next slide after one fails
export const OUTAGE_RETRY_MS = 30_000;   // pause once a whole round has failed (server unreachable)
export const WATCHDOG_MS = 2_000;        // how often the watchdog checks the deadline
const DEFAULT_IMAGE_SECONDS = 10;

export function createSlideshowClock({
  onChange,                // ({ index, generation }) => void: show slides[index] as a fresh slide
  onStuck = () => {},      // called after three whole rounds of slides have failed in a row
  now = () => Date.now(),
  timers = globalThis,     // { setTimeout, clearTimeout, setInterval, clearInterval }
} = {}) {
  let slides = [];
  let signature = null;    // of the playlist that's running
  let pending = null;      // { slides, signature }: a new playlist, waiting for the slide on screen
  let index = 0;
  let generation = 0;      // a new number for every slide start, so the view always remounts
  let phase = 'idle';      // idle | loading | showing | playing | holding | retrying
  let expectedEnd = Infinity;   // a video with a length: when the slideshow moves on at the latest
  let deadline = Infinity;
  let failures = 0;        // slides that failed in a row
  let timer = null;
  let watchdog = null;

  function clearTimer() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(ms, fn) {
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  }

  function show(i) {
    clearTimer();
    index = i;
    generation += 1;
    phase = 'loading';
    const length = slides[i].type === 'video' ? slides[i].length : null;
    expectedEnd = length > 0 ? now() + length * 1000 : Infinity;
    deadline = expectedEnd === Infinity ? now() + LOAD_TIMEOUT_MS : expectedEnd + GRACE_MS;
    // A video that never starts still moves on at its expected end
    if (expectedEnd !== Infinity) schedule(length * 1000, () => { if (phase === 'loading') fail(); });
    onChange({ index, generation });
  }

  function next() {
    if (pending) {
      adopt(pending);
      return;
    }
    if (slides.length) show((index + 1) % slides.length);
  }

  function adopt(list) {
    pending = null;
    slides = list.slides;
    signature = list.signature;
    failures = 0;
    if (slides.length) {
      show(0);
    } else {
      clearTimer();
      phase = 'idle';
      deadline = Infinity;
    }
  }

  function fail() {
    failures += 1;
    if (failures % (slides.length * 3) === 0) onStuck(failures);
    // A video with a length keeps its place until its expected end, then the next slide
    if (expectedEnd !== Infinity) {
      phase = 'holding';
      deadline = expectedEnd + GRACE_MS;
      schedule(Math.max(0, expectedEnd - now()), next);
      return;
    }
    // Skip quickly past a broken slide, but once a whole round has failed the server is
    // probably unreachable: slow down instead of spinning through slides that can't load
    const wait = failures >= slides.length ? OUTAGE_RETRY_MS : RETRY_MS;
    phase = 'retrying';
    deadline = now() + wait + GRACE_MS;
    schedule(wait, next);
  }

  function check() {
    if (!slides.length || now() <= deadline) return;
    // A video with a length that hasn't ended by its expected end (plus the grace): its time is up
    if (expectedEnd !== Infinity && phase === 'playing') next();
    else if (phase === 'loading' || phase === 'playing') fail();
    else next();   // a timer that should have fired didn't: move on anyway
  }

  // A playing video's deadline. Without a length: a stall's time from its last movement. With one:
  // its expected end, or, while it's still moving after that (it buffered), a moment after its last
  // movement; a video that stopped moving goes at its expected end
  function playingDeadline() {
    if (expectedEnd === Infinity) return now() + STALL_TIMEOUT_MS;
    return Math.max(expectedEnd + GRACE_MS, now() + GRACE_MS);
  }

  const isCurrent = (gen) => gen === generation;

  return {
    // A playlist arrived. The same one is sent again after every reconnect: keep going.
    // A changed one starts from its first slide, but only once the slide on screen has had its
    // full time (a video: once it ends), so a slideshow starting or ending never cuts short the
    // slide being shown. A slide still loading, or nothing to show any more, changes at once.
    setSlides(list) {
      const sig = JSON.stringify(list);
      if (sig === (pending ? pending.signature : signature)) return false;
      if (sig === signature) {
        pending = null;   // back to the playlist that's running: carry on with it
        return true;
      }
      const incoming = { slides: list, signature: sig };
      if (list.length && (phase === 'showing' || phase === 'playing')) {
        pending = incoming;
      } else {
        adopt(incoming);
      }
      return true;
    },

    // The slide is on screen: the image loaded, or the video started playing
    ready(gen) {
      if (!isCurrent(gen)) return;
      if (phase === 'playing') {
        deadline = playingDeadline();   // a video playing again after buffering
        return;
      }
      if (phase !== 'loading') return;
      failures = 0;
      const slide = slides[index];
      if (slide.type === 'video') {
        phase = 'playing';
        deadline = playingDeadline();
      } else {
        const ms = (slide.duration ?? DEFAULT_IMAGE_SECONDS) * 1000;
        phase = 'showing';
        deadline = now() + ms + GRACE_MS;
        schedule(ms, next);
      }
    },

    // A playing video moved forward
    progress(gen) {
      if (isCurrent(gen) && phase === 'playing') deadline = playingDeadline();
    },

    ended(gen) {
      if (isCurrent(gen) && (phase === 'playing' || phase === 'loading')) next();
    },

    failed(gen) {
      if (isCurrent(gen) && (phase === 'loading' || phase === 'playing')) fail();
    },

    // The page is back (visible, unfrozen, awake) or the server is reachable again: retry a
    // failed slide straight away, and catch up on any deadline missed in the meantime
    resume() {
      if (phase === 'retrying') next();
      else check();
    },

    start() {
      if (watchdog === null) watchdog = timers.setInterval(check, WATCHDOG_MS);
    },

    stop() {
      clearTimer();
      if (watchdog !== null) {
        timers.clearInterval(watchdog);
        watchdog = null;
      }
    },

    // For tests and debugging
    state: () => ({ index, generation, phase, deadline, expectedEnd, failures, waitingPlaylist: !!pending }),
  };
}
