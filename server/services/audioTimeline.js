// server/services/audioTimeline.js — where every audio show's timeline started, for every screen
//
// Responsibilities
//   The Server's side of the music in step (SYSTEM_DESIGN §18.8). Each audio show plays all the time
//   on its own timeline, "like a radio" (shared/musicTimeline.mjs): this gives each show the Server's
//   time its timeline started at (startedAt) and the track before it (after), which every screen
//   plays to.
//   - A show seen for the first time (start-up, published) starts now, from its first track.
//   - A change to what's played or when (the tracks, the order, the transition or fade) takes
//     effect when the track on at that moment ends, so no track is cut short: the new timeline
//     starts there, after that track (if it's still in the show). Until then the show is sent as it
//     was. Only the volume, or nothing that matters to the timeline, takes effect at once.
//   - An event starting: its show starts a new track then (after the one on its timeline). An
//     event ending: every other show starts again then, with the track after the one it was
//     playing when the event began: "afterwards, the next track" (§18.3).
//   Injectable clock and timers, so it can be tested.
//
// Provides
//   createAudioTimeline({ onSwitch, now, timers }) → {
//     offer(shows, event)   the audio shows as they are now (buildAudio's shows) and the event's show
//     current()             → { <folder>: { ...show, startedAt, after } }: what the screens play
//     stop()
//   }
//   onSwitch() is called when a deferred change takes effect (the caller sends the audio again)
//
// Used by
//   realtime/displaySocket.js; server/test/audioTimeline.test.js
//
// Uses
//   shared/musicTimeline.mjs (musicAt)
//
// Change impact
//   startedAt and after are part of the audio payload screens keep time to (SYSTEM_DESIGN §15: keys
//   added).
const { musicAt } = require('../../shared/musicTimeline.mjs');

// What matters to the timeline: a change in any of it moves the show to a new timeline
const timingKey = (show) => JSON.stringify([show.tracks.map((t) => [t.url, t.length]), show.order, show.transition, show.fadeSeconds]);

function createAudioTimeline({ onSwitch = () => {}, now = () => Date.now(), timers = globalThis } = {}) {
  const running = new Map();   // folder -> { show, key, startedAt, after, pending: { show, key, timer } | null }
  let event = null;
  let interrupted = new Map(); // folder -> the track it was playing when the event began

  const anchored = (entry) => ({ ...entry.show, startedAt: entry.startedAt, after: entry.after });
  const trackAt = (entry, t) => musicAt(anchored(entry), t)?.track ?? null;
  // The track's place in another version of the show (the same file), or null
  const sameTrackIn = (fromShow, index, toShow) => {
    const url = index === null ? null : fromShow.tracks[index]?.url;
    const found = url ? toShow.tracks.findIndex((x) => x.url === url) : -1;
    return found >= 0 ? found : null;
  };

  function cancel(entry) {
    if (entry.pending) timers.clearTimeout(entry.pending.timer);
    entry.pending = null;
  }

  // A new timeline for this show, starting at t, after the given track of the show it had
  function restart(entry, show, key, t, afterIndex) {
    cancel(entry);
    entry.after = sameTrackIn(entry.show, afterIndex, show);
    entry.show = show;
    entry.key = key;
    entry.startedAt = t;
  }

  function offer(shows, eventFolder = null) {
    const t = now();
    for (const [folder, entry] of running) {
      if (!shows[folder]) {
        cancel(entry);
        running.delete(folder);
      }
    }
    for (const [folder, show] of Object.entries(shows)) {
      const key = timingKey(show);
      const entry = running.get(folder);
      if (!entry) {
        running.set(folder, { show, key, startedAt: t, after: null, pending: null });
        continue;
      }
      if (key === entry.key) {
        // Nothing that matters to the timeline (e.g. the volume): at once; a pending change is dropped
        cancel(entry);
        entry.show = show;
        continue;
      }
      if (entry.pending?.key === key) {
        entry.pending.show = show;
        continue;
      }
      // A change: when the track on now ends
      cancel(entry);
      const at = musicAt(anchored(entry), t).end;
      const pending = { show, key, timer: null };
      pending.timer = timers.setTimeout(() => {
        restart(entry, pending.show, pending.key, at, trackAt(entry, at - 1));
        onSwitch();
      }, Math.max(0, at - t));
      entry.pending = pending;
    }

    // An event starting or ending
    const next = eventFolder && running.has(eventFolder) ? eventFolder : null;
    if (next !== event) {
      if (event !== null) {
        // It ended (or another took over): every other show carries on with its next track
        for (const [folder, entry] of running) {
          if (folder === next) continue;
          const show = entry.pending ? entry.pending.show : entry.show;
          const key = entry.pending ? entry.pending.key : entry.key;
          restart(entry, show, key, t, interrupted.has(folder) ? interrupted.get(folder) : trackAt(entry, t));
        }
      }
      if (next !== null) {
        interrupted = new Map([...running].map(([folder, entry]) => [folder, trackAt(entry, t)]));
        const entry = running.get(next);
        const show = entry.pending ? entry.pending.show : entry.show;
        const key = entry.pending ? entry.pending.key : entry.key;
        restart(entry, show, key, t, trackAt(entry, t));
      }
      event = next;
    }
  }

  function current() {
    const out = {};
    for (const [folder, entry] of running) out[folder] = anchored(entry);
    return out;
  }

  return {
    offer,
    current,
    stop() {
      for (const entry of running.values()) cancel(entry);
    },
  };
}

module.exports = { createAudioTimeline };
