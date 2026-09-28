// Tests for the Server's running timeline (services/playlistTimeline.js): a change takes effect at
// the end of the slide on air, for every screen at once; nothing on air: at once; the same playlist
// again changes nothing; going back before the switch cancels it. Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlaylistTimeline } = require('../services/playlistTimeline');

function setup() {
  let t = 100_000;
  let seq = 0;
  const queue = new Map();
  const timers = {
    setTimeout: (fn, ms) => { const id = ++seq; queue.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id) => queue.delete(id),
  };
  const switches = [];
  const tl = createPlaylistTimeline({ now: () => t, timers, onSwitch: (x) => switches.push(x) });
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
  return { tl, switches, run, now: () => t };
}
const img = (duration, url) => ({ type: 'image', url, duration });

test('nothing on air: a playlist starts at once', () => {
  const { tl, switches, now } = setup();
  tl.offer([img(3, 'a')]);
  assert.equal(switches.length, 1);
  assert.equal(switches[0].startedAt, now());
  assert.equal(tl.current().slides.length, 1);
});

test('a change takes effect when the slide on air ends, announced then', () => {
  const { tl, switches, run } = setup();
  tl.offer([img(3, 'a'), img(4, 'b')]);          // 7 s a round, from 100 000
  const started = switches[0].startedAt;
  run(4_500);                                     // on slide b (3–7 s)
  tl.offer([img(5, 'c')]);
  assert.equal(switches.length, 1, 'not yet');
  assert.equal(tl.current().slides[0].url, 'a', 'screens still play the running one');
  run(2_499);
  assert.equal(switches.length, 1, 'not before b ends');
  run(2);
  assert.equal(switches.length, 2);
  assert.equal(switches[1].startedAt, started + 7_000, 'exactly at the end of slide b');
  assert.equal(tl.current().slides[0].url, 'c');
});

test('the same playlist again changes nothing; going back before the switch cancels it', () => {
  const { tl, switches, run } = setup();
  const a = [img(3, 'a')];
  tl.offer(a);
  tl.offer([img(3, 'a')]);
  assert.equal(switches.length, 1);
  run(1_000);
  tl.offer([img(3, 'b')]);
  tl.offer([img(3, 'a')]);                        // back before the switch at 3 s
  run(5_000);
  assert.equal(switches.length, 1);
  assert.equal(tl.current().slides[0].url, 'a');
});

test('a second change before the switch replaces the first, at the same moment', () => {
  const { tl, switches, run } = setup();
  tl.offer([img(10, 'a')]);
  run(2_000);
  tl.offer([img(3, 'b')]);
  run(1_000);
  tl.offer([img(3, 'c')]);
  run(8_000);
  assert.equal(switches.length, 2);
  assert.equal(switches[1].slides[0].url, 'c');
  assert.equal(switches[1].startedAt, switches[0].startedAt + 10_000);
});

test('an empty playlist also waits for the slide on air', () => {
  const { tl, switches, run } = setup();
  tl.offer([img(5, 'a')]);
  run(1_000);
  tl.offer([]);
  assert.equal(switches.length, 1);
  run(4_000);
  assert.equal(switches.length, 2);
  assert.deepEqual(switches[1].slides, []);
});
