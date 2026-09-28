// Tests for the Server's music timelines (services/audioTimeline.js): a new show starts now; a change
// that matters to the timeline takes effect when the track on air ends, after that track; the volume
// at once; an event's show starts a new track; after the event every other show carries on with the
// track after the one it was playing. Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAudioTimeline } = require('../services/audioTimeline');
const { musicAt } = require('../../shared/musicTimeline.mjs');

function setup() {
  let t = 100_000;
  let seq = 0;
  const queue = new Map();
  const timers = {
    setTimeout: (fn, ms) => { const id = ++seq; queue.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id) => queue.delete(id),
  };
  let switches = 0;
  const tl = createAudioTimeline({ now: () => t, timers, onSwitch: () => { switches += 1; } });
  const run = (ms) => {
    const end = t + ms;
    for (;;) {
      const due = [...queue.entries()].filter(([, q]) => q.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      queue.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = end;
  };
  return { tl, run, now: () => t, switches: () => switches };
}
const show = (id, over = {}) => ({
  id, order: 'in-order', transition: 'none', fadeSeconds: 3, volume: 80,
  tracks: [{ url: `${id}/a`, length: 10 }, { url: `${id}/b`, length: 20 }, { url: `${id}/c`, length: 30 }],
  ...over,
});
const on = (tl, folder, t) => { const s = tl.current()[folder]; return s.tracks[musicAt(s, t).track].url; };

test('a show seen for the first time starts now, from its first track; the same shows again change nothing', () => {
  const { tl, now, run } = setup();
  tl.offer({ m: show('m') });
  assert.equal(tl.current().m.startedAt, now());
  assert.equal(tl.current().m.after, null);
  const before = JSON.stringify(tl.current());
  run(15_000);
  tl.offer({ m: show('m') });
  assert.equal(JSON.stringify(tl.current()), before);
  assert.equal(on(tl, 'm', now()), 'm/b');
});

test('the volume changes at once, on the same timeline', () => {
  const { tl, run, switches } = setup();
  tl.offer({ m: show('m') });
  const startedAt = tl.current().m.startedAt;
  run(5_000);
  tl.offer({ m: show('m', { volume: 30 }) });
  assert.equal(tl.current().m.volume, 30);
  assert.equal(tl.current().m.startedAt, startedAt);
  assert.equal(switches(), 0);
});

test('a new track: the change waits for the track on air to end, then carries on after it', () => {
  const { tl, run, now, switches } = setup();
  tl.offer({ m: show('m') });
  const start = now();
  run(15_000);   // track b (10 s to 30 s)
  const more = show('m', { tracks: [...show('m').tracks, { url: 'm/d', length: 5 }] });
  tl.offer({ m: more });
  assert.equal(tl.current().m.tracks.length, 3, 'sent as it was until then');
  run(14_999);
  assert.equal(switches(), 0);
  run(1);
  assert.equal(switches(), 1);
  assert.equal(tl.current().m.startedAt, start + 30_000);
  assert.equal(tl.current().m.tracks.length, 4);
  assert.equal(tl.current().m.after, 1, 'after b');
  assert.equal(on(tl, 'm', now()), 'm/c');
});

test('going back before the change takes effect cancels it; a removed show is forgotten', () => {
  const { tl, run, switches } = setup();
  tl.offer({ m: show('m') });
  run(5_000);
  tl.offer({ m: show('m', { order: 'shuffle' }) });
  tl.offer({ m: show('m') });
  run(60_000);
  assert.equal(switches(), 0);
  tl.offer({});
  assert.deepEqual(tl.current(), {});
});

test('an event: its show starts a new track; afterwards every other show plays the track after the one it was on', () => {
  const { tl, run, now } = setup();
  tl.offer({ m: show('m'), e: show('e') });
  run(15_000);                           // m on b, e on b
  tl.offer({ m: show('m'), e: show('e') }, 'e');
  assert.equal(tl.current().e.startedAt, now());
  assert.equal(on(tl, 'e', now()), 'e/c', 'a new track from its start');
  run(40_000);                           // the event plays on; m's own timeline moves on meanwhile
  tl.offer({ m: show('m'), e: show('e') }, null);
  assert.equal(tl.current().m.startedAt, now());
  assert.equal(on(tl, 'm', now()), 'm/c', 'the track after b, from its start');
  // The same state again changes nothing
  const before = JSON.stringify(tl.current());
  run(1_000);
  tl.offer({ m: show('m'), e: show('e') }, null);
  assert.equal(JSON.stringify(tl.current()), before);
});
