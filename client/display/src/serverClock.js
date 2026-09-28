// client/display/src/serverClock.js — the Server's time, as this screen can best tell it
//
// Responsibilities
//   Every screen keeps its slides and music in step with the others by working from the Server's
//   clock, not its own (SYSTEM_DESIGN §18.8). It measures how far its clock is from the Server's with
//   a timestamp exchange over the socket: it sends when it asked, the Server answers with its own
//   time, and the offset is server + round trip / 2 − received. The exchange with the shortest round
//   trip among the recent ones is the most accurate, so that one wins. Plain JavaScript with the
//   clock passed in, so it can be tested.
//
// Provides
//   createServerClock({ now }) → {
//     ping()                   → the payload to send (time:ping): { sent }
//     pong({ sent, server })   takes the Server's answer (time:pong); stale or odd answers are ignored
//     serverNow()              → this screen's best estimate of the Server's time (ms); its own
//                                clock until a first answer has come in
//     state()                  → { synced, offset, roundTrip, samples } for tests and diagnostics
//   }
//   The constants: SAMPLES_KEPT, BURST (exchanges at connect), BURST_GAP_MS, REFRESH_MS
//
// Used by
//   composables/useSocket.js (the exchanges); the slide and music timelines through serverNow;
//   client/display/test/serverClock.test.mjs
//
// Change impact
//   Every screen's timing follows serverNow: an error here puts screens out of step with each other.
export const SAMPLES_KEPT = 8;        // the most recent exchanges considered
export const BURST = 5;               // exchanges right after connecting
export const BURST_GAP_MS = 200;      // between those
export const REFRESH_MS = 5 * 60_000; // one more exchange this often
const MAX_ROUND_TRIP_MS = 10_000;     // slower answers say little about the offset

export function createServerClock({ now = () => Date.now() } = {}) {
  let samples = [];   // [{ offset, roundTrip }], newest last
  let best = null;

  function ping() {
    return { sent: now() };
  }

  function pong(answer) {
    const received = now();
    const sent = Number(answer?.sent);
    const server = Number(answer?.server);
    if (!Number.isFinite(sent) || !Number.isFinite(server)) return;
    const roundTrip = received - sent;
    if (roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) return;
    samples = [...samples, { offset: server + roundTrip / 2 - received, roundTrip }].slice(-SAMPLES_KEPT);
    best = samples.reduce((a, b) => (b.roundTrip < a.roundTrip ? b : a));
  }

  const serverNow = () => now() + (best ? best.offset : 0);

  function state() {
    return { synced: best !== null, offset: best ? best.offset : 0, roundTrip: best ? best.roundTrip : null, samples: samples.length };
  }

  return { ping, pong, serverNow, state };
}
