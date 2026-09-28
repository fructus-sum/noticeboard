// client/display/src/slideshowClock.js — which slide is on screen, in step with every other screen
//
// Built for screens that run unattended for months, and since 0.7.0 in step with each other
// (SYSTEM_DESIGN §18.8). The playlist comes with the Server's time it started at (startedAt), and the
// shared timeline (shared/slideTimeline.mjs) says, from the Server's time (serverNow), which slide
// is on and how far into it. So a screen that loads, reconnects or wakes goes straight to the slide
// every other screen shows, at the same point. A timer moves on at each slide's end, and a watchdog
// checks the timeline every couple of seconds, so a lost timer, a hidden, frozen or sleeping page, or
// a changed clock can't hold the slideshow up. A slide that can't be shown (an image that won't load,
// a video that won't play or stops) keeps its place until its time is up, so the screen stays in
// step; when every slide keeps failing (three whole rounds), onStuck is called (the page reloads once
// the server answers). A playlist without startedAt (an older server) starts when it arrives.
// Plain JavaScript with injectable timers and clock, so it can be tested over simulated weeks.
//
// Provides
//   createSlideshowClock({ onChange, onStuck, serverNow, timers }) → a clock: it calls onChange({
//   index, generation, offset, slotStart }) to show a slide (offset: seconds into it, for a video to
//   start at; slotStart: the Server's time it began), and onStuck after three whole rounds fail.
//   setSlides(slides, startedAt) takes a playlist; the slide's events (ready, progress, ended,
//   failed), resume(), start(), stop(), state()
//   The constants WATCHDOG_MS, DEFAULT_IMAGE_SECONDS (from the timeline)
//
// Used by
//   components/SlideShow.vue; client/display/test/slideshowClock.test.mjs
//
// Uses
//   shared/slideTimeline.mjs (positionAt)
//
// Change impact
//   All of the viewer's slide timing is here: change it with the tests (npm test), which simulate
//   30 days and screens with clocks minutes apart.
import { positionAt, DEFAULT_IMAGE_SECONDS } from '../../../shared/slideTimeline.mjs';

export { DEFAULT_IMAGE_SECONDS };
export const WATCHDOG_MS = 2_000;   // how often the watchdog checks the timeline
const TICK_SLACK_MS = 5;            // a slide's end timer fires just after the boundary

export function createSlideshowClock({
  onChange,                    // ({ index, generation, offset, slotStart }) => void: show slides[index] afresh
  onStuck = () => {},          // called after three whole rounds of slides have failed in a row
  serverNow = () => Date.now(),
  timers = globalThis,         // { setTimeout, clearTimeout, setInterval, clearInterval }
} = {}) {
  let slides = [];
  let startedAt = 0;
  let signature = null;        // of the playlist that's running
  let shown = null;            // { index, start, end }: the slot on screen
  let generation = 0;          // a new number for every slide start, so the view always remounts
  let slotFailed = false;      // the slide on screen reported a failure
  let failures = 0;            // slots that failed in a row
  let timer = null;
  let watchdog = null;

  function clearTimer() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  // Show what the timeline says now, and come back at the end of that slide
  function tick() {
    clearTimer();
    if (!slides.length) {
      shown = null;
      return;
    }
    const t = serverNow();
    const pos = positionAt(slides, startedAt, t);
    if (!shown || shown.index !== pos.index || shown.start !== pos.start) {
      // The slide that's ending failed without ever showing: count it
      if (shown && slotFailed) {
        failures += 1;
        if (failures % (slides.length * 3) === 0) onStuck(failures);
      }
      shown = { index: pos.index, start: pos.start, end: pos.end };
      slotFailed = false;
      generation += 1;
      onChange({ index: pos.index, generation, offset: Math.max(0, (t - pos.start) / 1000), slotStart: pos.start });
    }
    timer = timers.setTimeout(() => { timer = null; tick(); }, Math.max(0, shown.end - serverNow()) + TICK_SLACK_MS);
  }

  const isCurrent = (gen) => gen === generation;

  return {
    // A playlist arrived. The same one is sent again after every reconnect: keep going. A changed
    // one (the Server sends it when it takes effect, at a slide boundary) is followed at once.
    setSlides(list, at) {
      const sig = JSON.stringify([list, at ?? null]);
      if (sig === signature) return false;
      signature = sig;
      slides = list;
      startedAt = Number.isFinite(at) ? at : serverNow();
      shown = null;
      failures = 0;
      slotFailed = false;
      tick();
      return true;
    },

    // The slide is on screen (the image loaded, the video started): the slides aren't all failing
    ready(gen) {
      if (isCurrent(gen)) failures = 0;
    },

    // Kept for the slide events: the timeline, not the video, decides when the slide ends
    progress() {},
    ended() {},

    failed(gen) {
      if (isCurrent(gen)) slotFailed = true;
    },

    // The page is back (visible, unfrozen, awake) or the server is reachable again: catch up
    resume() {
      tick();
    },

    start() {
      if (watchdog === null) watchdog = timers.setInterval(tick, WATCHDOG_MS);
      tick();
    },

    stop() {
      clearTimer();
      if (watchdog !== null) {
        timers.clearInterval(watchdog);
        watchdog = null;
      }
    },

    // For tests and debugging
    state: () => ({ index: shown ? shown.index : null, generation, startedAt, slotStart: shown ? shown.start : null, slotEnd: shown ? shown.end : null, failures }),
  };
}
