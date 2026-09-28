// shared/audioPlayer.mjs — plays an audio show: the engine behind the screens' background audio and
// the admin panel's show preview (SYSTEM_DESIGN §18.3, §18.8)
//
// Responsibilities
//   Built like the slide clock (client/display/src/slideshowClock.js) for screens that run
//   unattended for months: plain JavaScript with the media elements, timers and clocks passed in,
//   so it can be tested over simulated days. Since 0.7.0 it plays in step with every other screen:
//   the show's timeline (shared/musicTimeline.mjs: its startedAt and after, from the Server) says,
//   on the Server's time (serverNow), which track is on and how far into it, "like a radio".
//   - A track starts at the point the timeline says (a screen joining, or coming back to a show,
//     joins it where it is now); one more than DRIFT_SEEK_S out is put back, smaller drift is eased
//     away by playing EASE_RATE faster or slower for a moment.
//   - Two media elements ("decks"), so one track can fade out while the next fades in: no
//     transition (the next track starts when one ends) or a crossfade (it starts fadeSeconds before
//     the end), in order or shuffled, as the timeline says.
//   - At the show's volume, times a "duck" factor (e.g. 0.2 while a video plays its own sound).
//   - Switching shows uses the new show's transition; no show fades out (FADE_OUT_MS).
//   - A track that can't be played stays silent until its time is up, so the next one starts in
//     step; a play() the browser refuses (NotAllowedError: a kiosk not yet allowed to play sound)
//     leaves it silent and tries again every RETRY_BLOCKED_MS, joining the timeline where it is.
//   - A show without startedAt (the admin panel's preview) gets a timeline of its own, starting when
//     it's first given; next() starts its next track now. A change to what it plays or when (tracks,
//     order, transition, fade) starts its next track then.
//
// Provides
//   createAudioPlayer({ createElement, timers, now, serverNow, onChange }) → a player:
//     setShow(show)      play this show ({ id, tracks: [{ url, length? }], order, transition,
//                        fadeSeconds, volume, startedAt?, after? }), or stop with null. The same show
//                        again changes nothing; a new volume applies at once
//     next()             the next track now (with the show's transition), on its own timeline
//     duck(factor, ms)   the volume times factor (0–1), reached over ms
//     pause(), resume()  silent meanwhile; resuming joins the timeline where it is then
//     retryNow()         the browser refused to play: try again now (after a click or key
//                        press, which lets a browser play sound); nothing otherwise
//     stop()             everything stops at once, nothing kept
//     destroy()          stop, and stop its timers too (the page is closing)
//     state()            → { show, track, playing, paused, blocked, duck } for tests and the admin
//                        panel's preview (track: the index in show.tracks, or null)
//   onChange(state) is called whenever the show or track changes.
//   The timing constants: FADE_OUT_MS, RAMP_STEP_MS, SYNC_MS, DRIFT_SEEK_S, DRIFT_EASE_S, EASE_RATE,
//   RETRY_BLOCKED_MS
//
// Used by
//   client/admin (components/audio/ShowPreview); client/display (components/BackgroundAudio);
//   client/display/test/audioPlayer.test.mjs
//
// Uses
//   shared/musicTimeline.mjs (musicAt)
//
// Change impact
//   All of the audio's timing is here: change it with the tests (npm test).
import { musicAt } from './musicTimeline.mjs';

export const FADE_OUT_MS = 1500;          // stopping, or moving to no show
export const RAMP_STEP_MS = 50;           // how often volumes move during a fade
export const SYNC_MS = 1_000;             // how often the track is checked against the timeline
export const DRIFT_SEEK_S = 0.25;         // further out than this: put back
export const DRIFT_EASE_S = 0.04;         // further out than this: eased back
export const EASE_RATE = 0.02;            // 2 % faster or slower while easing
export const RETRY_BLOCKED_MS = 60_000;   // the browser refused to play: try again after this
const SLACK_MS = 5;                       // a track's slot timer fires just after the boundary

const clamp01 = (x) => Math.max(0, Math.min(1, x));
// What matters to a timeline: a change in any of it moves a show without startedAt to a new one
const timingKey = (show) => JSON.stringify([show.tracks.map((t) => [t.url, t.length]), show.order, show.transition, show.fadeSeconds]);

export function createAudioPlayer({
  createElement,             // () => an HTMLAudioElement (or a test double)
  timers = globalThis,       // { setTimeout, clearTimeout, setInterval, clearInterval }
  now = () => Date.now(),    // this screen's clock, for fades
  serverNow = now,           // the Server's time, for the timeline (the viewer: useSocket's serverNow)
  onChange = () => {},
} = {}) {
  let show = null;           // the show playing, with its timeline (startedAt, after)
  let sig = null;
  let local = null;          // { id, key, startedAt, after }: the timeline of a show without startedAt
  let duckFactor = 1;
  let duckRamp = null;       // { from, to, start, end }
  let paused = false;
  let blocked = false;
  let failedSlot = null;     // the slot (its start) whose track couldn't be played: silent until its end
  let slotTimer = null;
  let retryTimer = null;
  let rampTimer = null;

  // Two decks, used in turn
  const decks = [0, 1].map(() => ({
    el: null,
    track: null,             // index in show.tracks
    url: null,               // its file (the same index in another show is another track)
    slot: null,              // when its slot began on the timeline (the Server's time)
    gain: 0,
    ramp: null,              // { from, to, start, end, then }
    token: 0,                // bumped whenever the deck is (re)loaded: old events are ignored
  }));
  let active = 0;

  function element(deck) {
    if (!deck.el) {
      const el = createElement();
      const d = deck;
      el.addEventListener('error', () => onError(d, d.token));
      deck.el = el;
    }
    return deck.el;
  }

  // ── Volumes ─────────────────────────────────────────────────────────────────

  const rampValue = (r, t) => (t >= r.end ? r.to : r.from + (r.to - r.from) * ((t - r.start) / (r.end - r.start)));

  function applyVolumes() {
    const t = now();
    if (duckRamp) {
      duckFactor = rampValue(duckRamp, t);
      if (t >= duckRamp.end) duckRamp = null;
    }
    let ramping = !!duckRamp;
    for (const deck of decks) {
      if (deck.ramp) {
        deck.gain = rampValue(deck.ramp, t);
        if (t >= deck.ramp.end) {
          const then = deck.ramp.then;
          deck.ramp = null;
          if (then) then();
        } else {
          ramping = true;
        }
      }
      if (deck.el) deck.el.volume = clamp01((show ? show.volume / 100 : 1) * deck.gain * duckFactor);
    }
    if (!ramping && rampTimer !== null) {
      timers.clearInterval(rampTimer);
      rampTimer = null;
    }
  }

  function rampDeck(deck, to, ms, then) {
    if (ms <= 0) {
      deck.gain = to;
      deck.ramp = null;
      applyVolumes();
      if (then) then();
      return;
    }
    deck.ramp = { from: deck.gain, to, start: now(), end: now() + ms, then };
    if (rampTimer === null) rampTimer = timers.setInterval(applyVolumes, RAMP_STEP_MS);
    applyVolumes();
  }

  function silence(deck) {
    deck.token += 1;
    deck.ramp = null;
    deck.gain = 0;
    deck.track = null;
    deck.url = null;
    deck.slot = null;
    if (deck.el) {
      deck.el.pause();
      deck.el.volume = 0;
      // Let go of the file (its download and the memory holding it) until the deck plays again;
      // its old events are ignored (the token), so this raises no error
      deck.el.removeAttribute?.('src');
      deck.el.load?.();
    }
  }

  // ── Playing to the timeline ─────────────────────────────────────────────────

  function state() {
    const deck = decks[active];
    return { show: show ? show.id : null, track: deck.track, playing: deck.track !== null && !paused && !blocked, paused, blocked, duck: duckFactor };
  }
  const changed = () => onChange(state());

  // Start the slot's track on the other deck at the point the timeline says, fading it in over
  // fadeMs, and the one playing out
  function start(pos, t, fadeMs) {
    const from = decks[active];
    const to = decks[1 - active];
    silence(to);
    active = decks.indexOf(to);
    if (from.track !== null) rampDeck(from, 0, fadeMs, () => silence(from));
    const el = element(to);
    const token = to.token;
    to.track = pos.track;
    to.url = show.tracks[pos.track].url;
    to.slot = pos.start;
    to.gain = fadeMs > 0 ? 0 : 1;
    el.src = to.url;
    try { el.playbackRate = 1; } catch { /* a test double */ }
    try { el.currentTime = Math.max(0, (t - pos.start) / 1000); } catch { /* not loaded yet: put right once it is */ }
    applyVolumes();
    changed();
    let result;
    try {
      result = el.play();
    } catch (err) {
      result = Promise.reject(err);
    }
    Promise.resolve(result).then(() => {
      if (to.token !== token) return;
      rampDeck(to, 1, fadeMs);
    }, (err) => {
      if (to.token !== token) return;
      if (err && err.name === 'NotAllowedError') refused();
      else onError(to, token);
    });
  }

  // The track playing, kept to the timeline
  function keepInStep(deck, pos, t) {
    const el = deck.el;
    if (!el || el.ended || !Number.isFinite(el.duration)) return;
    const want = (t - pos.start) / 1000;
    if (want >= el.duration) return;   // its last moments, fading out under the next track
    const off = want - el.currentTime;
    if (Math.abs(off) > DRIFT_SEEK_S) {
      try { el.currentTime = want; el.playbackRate = 1; } catch { /* not seekable yet */ }
    } else {
      try { el.playbackRate = Math.abs(off) > DRIFT_EASE_S ? 1 + Math.sign(off) * EASE_RATE : 1; } catch { /* a test double */ }
    }
  }

  // Where the timeline is now: the right track at the right point, and a timer for the next one
  function sync() {
    timers.clearTimeout(slotTimer);
    slotTimer = null;
    if (!show || paused || blocked) return;
    const t = serverNow();
    const pos = musicAt(show, t);
    if (!pos) return;
    const deck = decks[active];
    if (deck.url === show.tracks[pos.track].url && deck.slot === pos.start) {
      keepInStep(deck, pos, t);
    } else if (failedSlot !== pos.start) {
      failedSlot = null;
      start(pos, t, show.transition === 'crossfade' && deck.track !== null ? show.fadeSeconds * 1000 : 0);
    }
    slotTimer = timers.setTimeout(sync, Math.max(0, pos.end - t) + SLACK_MS);
  }
  const syncTimer = timers.setInterval(sync, SYNC_MS);

  // The browser refused to play sound: stay silent, try again later
  function refused() {
    blocked = true;
    for (const deck of decks) silence(deck);
    changed();
    timers.clearTimeout(retryTimer);
    retryTimer = timers.setTimeout(retryNow, RETRY_BLOCKED_MS);
  }

  function retryNow() {
    if (!blocked || !show) return;
    timers.clearTimeout(retryTimer);
    retryTimer = null;
    blocked = false;
    sync();
  }

  // A track that can't be played: silent until its slot ends, then the next one, in step
  function onError(deck, token) {
    // A late error from a deck already silenced (its file let go of) is ignored
    if (deck.token !== token || deck.track === null) return;
    const wasActive = decks[active] === deck;
    const slot = deck.slot;
    silence(deck);
    if (!wasActive) return;
    failedSlot = slot;
    changed();
  }

  // ── The show ────────────────────────────────────────────────────────────────

  // The show with its timeline: the Server's, or one of its own (the preview)
  function withTimeline(next) {
    if (next.startedAt != null) {
      local = null;
      return next;
    }
    const key = timingKey(next);
    if (!local || local.id !== next.id) {
      local = { id: next.id, key, startedAt: serverNow(), after: null };
    } else if (local.key !== key) {
      // Changed while playing: its next track, now
      const playing = decks[active].track;
      const url = playing !== null && show ? show.tracks[playing]?.url : null;
      const after = url ? next.tracks.findIndex((x) => x.url === url) : -1;
      local = { id: next.id, key, startedAt: serverNow(), after: after >= 0 ? after : null };
    }
    return { ...next, startedAt: local.startedAt, after: local.after };
  }

  function setShow(next) {
    if (next && !next.tracks?.length) next = null;
    const played = next ? withTimeline(next) : null;
    const nextSig = played ? JSON.stringify(played) : null;
    if (nextSig === sig) return;
    sig = nextSig;
    const sameShow = show && played && show.id === played.id;

    if (!played) {
      show = null;
      local = null;
      failedSlot = null;
      timers.clearTimeout(slotTimer);
      timers.clearTimeout(retryTimer);
      slotTimer = null;
      retryTimer = null;
      blocked = false;
      paused = false;
      for (const deck of decks) if (deck.track !== null) rampDeck(deck, 0, FADE_OUT_MS, () => silence(deck));
      changed();
      return;
    }
    show = played;
    if (!sameShow) {
      failedSlot = null;
      timers.clearTimeout(retryTimer);
      retryTimer = null;
      blocked = false;
      paused = false;
      changed();
    }
    applyVolumes();
    sync();
  }

  // The next track now: a new timeline of its own from here (the preview's ⏭)
  function next() {
    if (!show || blocked) return;
    const playing = decks[active].track;
    local = { id: show.id, key: timingKey(show), startedAt: serverNow(), after: playing };
    show = { ...show, startedAt: local.startedAt, after: playing };
    sig = JSON.stringify(show);
    failedSlot = null;
    sync();
  }

  function duck(factor, ms = 0) {
    const to = clamp01(factor);
    if (ms <= 0) {
      duckRamp = null;
      duckFactor = to;
      applyVolumes();
      return;
    }
    duckRamp = { from: duckFactor, to, start: now(), end: now() + ms };
    if (rampTimer === null) rampTimer = timers.setInterval(applyVolumes, RAMP_STEP_MS);
  }

  function pause() {
    if (paused) return;
    paused = true;
    timers.clearTimeout(slotTimer);
    slotTimer = null;
    for (const deck of decks) if (deck.el) deck.el.pause();
    changed();
  }

  // Carry on where the timeline is now: the same track put forward, or the one on by then
  function resume() {
    if (!paused) return;
    paused = false;
    const deck = decks[active];
    const pos = show && !blocked ? musicAt(show, serverNow()) : null;
    if (pos && deck.url === show.tracks[pos.track].url && deck.slot === pos.start && deck.el) {
      Promise.resolve(deck.el.play()).then(() => rampDeck(deck, 1, 0), () => {});
    }
    changed();
    sync();
  }

  function stop() {
    show = null;
    sig = null;
    local = null;
    paused = false;
    blocked = false;
    failedSlot = null;
    timers.clearTimeout(slotTimer);
    timers.clearTimeout(retryTimer);
    slotTimer = null;
    retryTimer = null;
    for (const deck of decks) silence(deck);
    changed();
  }

  function destroy() {
    stop();
    timers.clearInterval(syncTimer);
    if (rampTimer !== null) timers.clearInterval(rampTimer);
    rampTimer = null;
  }

  return { setShow, next, duck, pause, resume, retryNow, stop, destroy, state };
}
