// Decides when the display moves on to the next slide. Built for screens that run unattended
// for months: every slide has a deadline, and a watchdog moves on whenever that deadline
// passes, whatever the reason (a lost timer, an image that never loads, a video that stalls,
// a page that was hidden, frozen or asleep). Plain JavaScript with injectable timers so the
// behaviour can be tested over simulated weeks.

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
  let signature = null;
  let index = 0;
  let generation = 0;      // a new number for every slide start, so the view always remounts
  let phase = 'idle';      // idle | loading | showing | playing | retrying
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
    deadline = now() + LOAD_TIMEOUT_MS;
    onChange({ index, generation });
  }

  function next() {
    if (slides.length) show((index + 1) % slides.length);
  }

  function fail() {
    failures += 1;
    if (failures % (slides.length * 3) === 0) onStuck(failures);
    // Skip quickly past a broken slide, but once a whole round has failed the server is
    // probably unreachable: slow down instead of spinning through slides that can't load
    const wait = failures >= slides.length ? OUTAGE_RETRY_MS : RETRY_MS;
    phase = 'retrying';
    deadline = now() + wait + GRACE_MS;
    schedule(wait, next);
  }

  function check() {
    if (!slides.length || now() <= deadline) return;
    if (phase === 'loading' || phase === 'playing') fail();
    else next();   // a timer that should have fired didn't: move on anyway
  }

  const isCurrent = (gen) => gen === generation;

  return {
    // A playlist arrived. The same one is sent again after every reconnect: keep going.
    // A changed one starts again from the first slide.
    setSlides(list) {
      const sig = JSON.stringify(list);
      if (sig === signature) return false;
      signature = sig;
      slides = list;
      failures = 0;
      if (slides.length) {
        show(0);
      } else {
        clearTimer();
        phase = 'idle';
        deadline = Infinity;
      }
      return true;
    },

    // The slide is on screen: the image loaded, or the video started playing
    ready(gen) {
      if (!isCurrent(gen)) return;
      if (phase === 'playing') {
        deadline = now() + STALL_TIMEOUT_MS;   // a video playing again after buffering
        return;
      }
      if (phase !== 'loading') return;
      failures = 0;
      const slide = slides[index];
      if (slide.type === 'video') {
        phase = 'playing';
        deadline = now() + STALL_TIMEOUT_MS;
      } else {
        const ms = (slide.duration ?? DEFAULT_IMAGE_SECONDS) * 1000;
        phase = 'showing';
        deadline = now() + ms + GRACE_MS;
        schedule(ms, next);
      }
    },

    // A playing video moved forward
    progress(gen) {
      if (isCurrent(gen) && phase === 'playing') deadline = now() + STALL_TIMEOUT_MS;
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
    state: () => ({ index, generation, phase, deadline, failures }),
  };
}
