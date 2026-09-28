// shared/musicTimeline.mjs — which track of an audio show is on at a given moment, the same on every screen
//
// Responsibilities
//   The music's side of "every screen in step" (SYSTEM_DESIGN §18.8), as shared/slideTimeline.mjs is
//   the slides'. An audio show and the Server's time its timeline started at (startedAt) make a
//   timeline that plays round and round, "like a radio": given the Server's time, every screen (and
//   the Server) finds the same track and the same point in it.
//   - In order: the tracks in turn, starting with the one after `after` (the track that played just
//     before the timeline started: e.g. before an event took over), or the first.
//   - Shuffled: each round's order is drawn from a seed made of the show, startedAt and the round,
//     so every screen draws the same one; never the same track twice in a row (nor `after` first).
//     Two tracks simply take turns.
//   - A crossfade starts the next track fadeSeconds before the end of one (a track too short for a
//     fade in and out, 2 × fadeSeconds, plays to its end); so a track's slot is its length less the
//     fade.
//   - A track without a known length counts as UNKNOWN_TRACK_SECONDS.
//   Plain JavaScript with no state or randomness of its own.
//
// Provides
//   trackMs(show, index)       → the track's length (ms)
//   slotMs(show, index)        → its time on the timeline (ms): until the next track starts
//   sequence(show, round)      → the order of the track indices in that round
//   musicAt(show, t)           → { track, start, end, round } at time t (ms): the track on, when it
//                                started and when the next one starts; null without tracks. Before
//                                startedAt: the first track, from startedAt
//   UNKNOWN_TRACK_SECONDS
//
// Used by
//   shared/audioPlayer.mjs, server/services/audioTimeline.js; tests
//
// Change impact
//   The Server and every screen must agree on this rule: change it only with its tests.
export const UNKNOWN_TRACK_SECONDS = 180;

export function trackMs(show, index) {
  const length = show?.tracks?.[index]?.length;
  return (length > 0 ? length : UNKNOWN_TRACK_SECONDS) * 1000;
}

export function slotMs(show, index) {
  const length = trackMs(show, index);
  const fade = show?.transition === 'crossfade' && show.fadeSeconds > 0 ? show.fadeSeconds * 1000 : 0;
  return fade > 0 && length > fade * 2 ? length - fade : length;
}

// A small seeded random number generator (mulberry32) and a string hash (FNV-1a): the same seed
// draws the same numbers on every screen and on the Server
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(show, round) {
  const random = seeded(hash(`${show.id}|${show.startedAt}|${round}`));
  const indices = show.tracks.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

const validAfter = (show) => (Number.isInteger(show.after) && show.after >= 0 && show.after < show.tracks.length ? show.after : null);

export function sequence(show, round) {
  const n = show.tracks.length;
  const after = validAfter(show);
  if (show.order !== 'shuffle' || n <= 2) {
    const first = after === null ? 0 : (after + 1) % n;
    return show.tracks.map((_, i) => (first + i) % n);
  }
  const order = shuffled(show, round);
  // Never the same track twice in a row: across rounds, and after the track before the timeline.
  // Only the first two ever swap, so a round's last track is always its drawn one.
  const before = round === 0 ? after : shuffled(show, round - 1)[n - 1];
  if (order[0] === before) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

export function musicAt(show, t) {
  if (!show?.tracks?.length) return null;
  const startedAt = show.startedAt ?? 0;
  const slots = show.tracks.map((_, i) => slotMs(show, i));
  const cycle = slots.reduce((a, b) => a + b, 0);
  const round = Math.floor(Math.max(0, t - startedAt) / cycle);
  const order = sequence(show, round);
  let start = startedAt + round * cycle;
  for (let k = 0; k < order.length; k++) {
    const end = start + slots[order[k]];
    if (t < end || k === order.length - 1) return { track: order[k], start, end, round };
    start = end;
  }
  return null;   // not reached
}
