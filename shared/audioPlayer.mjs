// shared/audioPlayer.mjs — plays an audio show: the engine behind the screens' background audio and
// the admin panel's show preview (SYSTEM_DESIGN §18.3)
//
// Responsibilities
//   Built like the slide clock (client/display/src/slideshowClock.js) for screens that run
//   unattended for months: plain JavaScript with the media elements, timers, clock and randomness
//   passed in, so it can be tested over simulated days. It plays one show at a time on two media
//   elements ("decks"), so one track can fade out while the next fades in:
//   - in order, or shuffled (a new order every time round, never the same track twice in a row);
//   - no transition (the next track starts when one ends) or a crossfade (it starts fadeSeconds
//     before the end, one fading in while the other fades out);
//   - at the show's volume, times a "duck" factor (e.g. 0.2 while a video plays its own sound);
//   - switching shows uses the new show's transition; no show fades out (FADE_OUT_MS);
//   - coming back to a show carries on with the track after the one it was playing (event audio's
//     "start the next track" when it ends);
//   - a track that can't be played is skipped (ERROR_WAIT_MS); one that stalls moves on at its
//     length plus STALL_GRACE_MS; a play() the browser refuses (NotAllowedError: a kiosk not yet
//     allowed to play sound) leaves it silent and tries again every RETRY_BLOCKED_MS.
//
// Provides
//   createAudioPlayer({ createElement, timers, now, random, onChange }) → a player:
//     setShow(show)      play this show ({ id, tracks: [{ url, length? }], order, transition,
//                        fadeSeconds, volume }), or stop with null. The same show again (same
//                        tracks and settings) changes nothing; changed settings or tracks apply
//                        without restarting the track playing
//     next()             the next track now (with the show's transition)
//     duck(factor, ms)   the volume times factor (0–1), reached over ms
//     pause(), resume()  holds the track where it is, and carries on
//     retryNow()         the browser refused to play: try again now (after a click or key
//                        press, which lets a browser play sound); nothing otherwise
//     stop()             everything stops at once, nothing kept
//     destroy()          stop, and stop its timers too (the page is closing)
//     state()            → { show, track, playing, paused, blocked, duck } for tests and the admin
//                        panel's preview (track: the index in show.tracks, or null)
//   onChange(state) is called whenever the show or track changes.
//   The timing constants: FADE_OUT_MS, RAMP_STEP_MS, ERROR_WAIT_MS, STALL_GRACE_MS, RETRY_BLOCKED_MS
//
// Used by
//   client/admin (components/audio/ShowPreview); client/display (components/BackgroundAudio);
//   client/display/test/audioPlayer.test.mjs
//
// Change impact
//   All of the audio's timing is here: change it with the tests (npm test).
export const FADE_OUT_MS = 1500;          // stopping, or moving to no show
export const RAMP_STEP_MS = 50;           // how often volumes move during a fade
export const ERROR_WAIT_MS = 2_000;       // a track that can't be played: the next one after this
export const STALL_GRACE_MS = 10_000;     // a track that hasn't ended by its length plus this moves on
export const RETRY_BLOCKED_MS = 60_000;   // the browser refused to play: try again after this

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const signature = (show) => JSON.stringify(show);

export function createAudioPlayer({
  createElement,             // () => an HTMLAudioElement (or a test double)
  timers = globalThis,       // { setTimeout, clearTimeout, setInterval, clearInterval }
  now = () => Date.now(),
  random = Math.random,
  onChange = () => {},
} = {}) {
  let show = null;
  let sig = null;
  let order = [];            // indices into show.tracks, this round
  let pos = -1;              // place in order of the track playing
  const lastTrack = new Map();   // show id -> the track index it was playing when it was left
  let duckFactor = 1;
  let duckRamp = null;       // { from, to, start, end }
  let paused = false;
  let blocked = false;
  let failures = 0;          // tracks that failed in a row
  let retryTimer = null;
  let rampTimer = null;

  // Two decks, used in turn
  const decks = [0, 1].map(() => ({
    el: null,
    track: null,             // index in show.tracks
    gain: 0,
    ramp: null,              // { from, to, start, end, then }
    started: 0,              // when its track started, for the stall check
    length: null,            // its track's expected length in ms
    moving: false,           // it already started the next track (crossfade)
    token: 0,                // bumped whenever the deck is (re)loaded: old events are ignored
  }));
  let active = 0;

  function element(deck) {
    if (!deck.el) {
      const el = createElement();
      const d = deck;
      el.addEventListener('ended', () => onEnded(d, d.token));
      el.addEventListener('error', () => onError(d, d.token));
      el.addEventListener('timeupdate', () => onTime(d, d.token));
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
    deck.moving = false;
    if (deck.el) {
      deck.el.pause();
      deck.el.volume = 0;
    }
  }

  // ── Order ───────────────────────────────────────────────────────────────────

  function newRound(previous) {
    const indices = show.tracks.map((_, i) => i);
    if (show.order === 'shuffle') {
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      // Never the same track twice in a row across rounds
      if (indices.length > 1 && indices[0] === previous) [indices[0], indices[1]] = [indices[1], indices[0]];
    }
    return indices;
  }

  function advance() {
    const previous = pos >= 0 ? order[pos] : null;
    pos += 1;
    if (pos >= order.length) {
      order = newRound(previous);
      pos = 0;
    }
    return order[pos];
  }

  // ── Playing tracks ──────────────────────────────────────────────────────────

  function state() {
    const deck = decks[active];
    return { show: show ? show.id : null, track: deck.track, playing: deck.track !== null && !paused && !blocked, paused, blocked, duck: duckFactor };
  }
  const changed = () => onChange(state());

  // Start track index `track` on the other deck, fading it in over fadeMs, and the current one out
  function start(track, fadeMs) {
    const from = decks[active];
    const to = decks[1 - active];
    silence(to);
    active = decks.indexOf(to);
    if (from.track !== null) rampDeck(from, 0, fadeMs, () => silence(from));
    const el = element(to);
    const token = to.token;
    to.track = track;
    to.gain = fadeMs > 0 ? 0 : 1;
    to.moving = false;
    to.started = now();
    const length = show.tracks[track]?.length;
    to.length = length > 0 ? length * 1000 : null;
    el.src = show.tracks[track].url;
    try { el.currentTime = 0; } catch { /* not loaded yet */ }
    applyVolumes();
    changed();
    if (paused) return;
    let result;
    try {
      result = el.play();
    } catch (err) {
      result = Promise.reject(err);
    }
    Promise.resolve(result).then(() => {
      if (to.token !== token) return;
      failures = 0;
      rampDeck(to, 1, fadeMs);
    }, (err) => {
      if (to.token !== token) return;
      if (err && err.name === 'NotAllowedError') refused();
      else onError(to, token);
    });
  }

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
    start(order[pos] ?? advance(), 0);
  }

  function next(fadeMs = show && show.transition === 'crossfade' ? show.fadeSeconds * 1000 : 0) {
    if (!show || !show.tracks.length || blocked) return;
    start(advance(), fadeMs);
  }

  function onEnded(deck, token) {
    if (deck.token !== token || decks[active] !== deck || deck.moving) return;
    next(0);
  }

  function onError(deck, token) {
    if (deck.token !== token) return;
    const wasActive = decks[active] === deck;
    silence(deck);
    if (!wasActive || !show) return;
    failures += 1;
    // Every track failed in a row: probably nothing can be fetched; slow down
    const wait = show.tracks.length && failures >= show.tracks.length ? RETRY_BLOCKED_MS : ERROR_WAIT_MS;
    timers.clearTimeout(retryTimer);
    retryTimer = timers.setTimeout(() => { retryTimer = null; next(0); }, wait);
  }

  function onTime(deck, token) {
    if (deck.token !== token || decks[active] !== deck || deck.moving || paused || !show) return;
    if (show.transition !== 'crossfade') return;
    const el = deck.el;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (deck.length ?? 0) / 1000;
    const fade = show.fadeSeconds;
    if (duration > fade * 2 && duration - el.currentTime <= fade) {
      deck.moving = true;
      next(fade * 1000);
    }
  }

  // A track that neither ends nor fails (a stalled download): move on after its length
  function watchdog() {
    const deck = decks[active];
    if (!show || paused || blocked || deck.track === null || !deck.length) return;
    if (now() > deck.started + deck.length + STALL_GRACE_MS) next(0);
  }
  const watchdogTimer = timers.setInterval(watchdog, 1000);

  // ── The show ────────────────────────────────────────────────────────────────

  function setShow(next) {
    if (next && !next.tracks?.length) next = null;
    const nextSig = next ? signature(next) : null;
    if (nextSig === sig) return;
    const sameShow = show && next && show.id === next.id;
    const leaving = show && decks[active].track !== null ? { id: show.id, track: decks[active].track } : null;
    sig = nextSig;

    if (sameShow) {
      // Changed settings or tracks: keep playing, from the next track on with the new ones
      const playing = decks[active].track;
      show = next;
      order = newRound(playing);
      pos = -1;
      if (playing !== null && playing >= show.tracks.length) start(advance(), 0);
      applyVolumes();
      return;
    }
    if (leaving) lastTrack.set(leaving.id, leaving.track);
    timers.clearTimeout(retryTimer);
    retryTimer = null;
    blocked = false;
    paused = false;

    if (!next) {
      show = null;
      order = [];
      pos = -1;
      for (const deck of decks) if (deck.track !== null) rampDeck(deck, 0, FADE_OUT_MS, () => silence(deck));
      changed();
      return;
    }
    const wasPlaying = decks[active].track !== null;
    show = next;
    order = newRound(null);
    pos = -1;
    // Coming back to a show: carry on after the track it was playing
    const left = lastTrack.get(show.id);
    if (left !== undefined && left < show.tracks.length) {
      if (show.order === 'in-order') pos = left;
      else order = newRound(left);
    }
    const fade = show.transition === 'crossfade' && wasPlaying ? show.fadeSeconds * 1000 : 0;
    start(advance(), fade);
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
    for (const deck of decks) if (deck.el) deck.el.pause();
    changed();
  }

  function resume() {
    if (!paused) return;
    paused = false;
    const deck = decks[active];
    if (deck.track !== null && deck.el && !blocked) {
      deck.started = now() - (deck.el.currentTime || 0) * 1000;
      Promise.resolve(deck.el.play()).then(() => rampDeck(deck, 1, 0), () => {});
    } else if (show && !blocked) {
      start(order[pos] ?? advance(), 0);
    }
    changed();
  }

  function stop() {
    show = null;
    sig = null;
    order = [];
    pos = -1;
    paused = false;
    blocked = false;
    timers.clearTimeout(retryTimer);
    retryTimer = null;
    for (const deck of decks) silence(deck);
    changed();
  }

  function destroy() {
    stop();
    timers.clearInterval(watchdogTimer);
    if (rampTimer !== null) timers.clearInterval(rampTimer);
    rampTimer = null;
  }

  return { setShow, next: () => next(), duck, pause, resume, retryNow, stop, destroy, state };
}
