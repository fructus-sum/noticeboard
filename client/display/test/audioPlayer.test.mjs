// Tests for the audio engine (shared/audioPlayer.mjs), over simulated time: fake audio elements
// that play, end, fail, stall or are refused, and a scheduler that jumps to the next due timer, so
// hours of music run in milliseconds. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioPlayer, FADE_OUT_MS, ERROR_WAIT_MS, STALL_GRACE_MS, RETRY_BLOCKED_MS,
} from '../../../shared/audioPlayer.mjs';

const TICK_MS = 250;   // how often a playing fake element moves on (like timeupdate)

function createScheduler() {
  let t = 0;
  let seq = 0;
  const queue = new Map();
  const add = (fn, ms, every) => { const id = ++seq; queue.set(id, { at: t + Math.max(0, ms), fn, every }); return id; };
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => add(fn, ms, 0),
      clearTimeout: (id) => queue.delete(id),
      setInterval: (fn, ms) => add(fn, ms, ms),
      clearInterval: (id) => queue.delete(id),
    },
    run(ms) {
      const end = t + ms;
      for (;;) {
        let id = null; let due = null;
        for (const [k, q] of queue) if (q.at <= end && (!due || q.at < due.at)) { id = k; due = q; }
        if (!due) break;
        t = due.at;
        if (due.every) due.at = t + due.every; else queue.delete(id);
        due.fn();
      }
      t = end;
    },
  };
}

// The browser's side: elements that play tracks of the given lengths
function setup({ lengths = {}, broken = new Set(), stalls = new Set(), refuse = () => false, random } = {}) {
  const sched = createScheduler();
  const elements = [];
  const log = [];   // [time, url] each time a track starts playing
  const stats = { plays: 0 };   // every play() call, refused or not
  function createElement() {
    const listeners = {};
    const el = {
      volume: 1, currentTime: 0, duration: NaN, playing: false, _src: '',
      set src(url) { this._src = url; this.duration = lengths[url] ?? NaN; this.currentTime = 0; this.playing = false; this.logged = false; },
      get src() { return this._src; },
      addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
      emit: (name) => (listeners[name] || []).forEach((fn) => fn()),
      play() {
        stats.plays += 1;
        if (refuse()) return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' }));
        if (broken.has(this._src)) { const e = this; sched.timers.setTimeout(() => e.emit('error'), 10); return Promise.reject(Object.assign(new Error('bad'), { name: 'NotSupportedError' })); }
        this.playing = true;
        if (!this.logged) log.push([sched.now(), this._src]);   // a track starting, not one resuming
        this.logged = true;
        return Promise.resolve();
      },
      pause() { this.playing = false; },
    };
    elements.push(el);
    return el;
  }
  sched.timers.setInterval(() => {
    for (const el of elements) {
      if (!el.playing) continue;
      if (stalls.has(el._src) && el.currentTime >= el.duration / 2) continue;
      el.currentTime = Math.min(el.duration, el.currentTime + TICK_MS / 1000);
      el.emit('timeupdate');
      if (el.currentTime >= el.duration) { el.playing = false; el.emit('ended'); }
    }
  }, TICK_MS);
  const player = createAudioPlayer({ createElement, timers: sched.timers, now: sched.now, random });
  // Promise callbacks run between timer jumps
  const run = async (ms, step = 1000) => { for (let done = 0; done < ms; done += step) { sched.run(Math.min(step, ms - done)); await Promise.resolve(); await Promise.resolve(); } };
  const audible = () => elements.filter((e) => e.playing).map((e) => ({ url: e._src, volume: +e.volume.toFixed(2) }));
  return { sched, player, log, elements, run, audible, stats };
}

const show = (id, n, extra = {}) => ({
  id, order: 'in-order', transition: 'none', fadeSeconds: 3, volume: 100,
  tracks: Array.from({ length: n }, (_, i) => ({ url: `/audio/${id}/tracks/${i}.m4a`, length: 10 })), ...extra,
});
const lengthsOf = (...shows) => Object.fromEntries(shows.flatMap((s) => s.tracks.map((t) => [t.url, t.length])));
const names = (log) => log.map(([, url]) => url.split('/').pop());

test('in order: each track plays to its end, then the next, round and round', async () => {
  const a = show('a', 3);
  const { player, log, run } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(65_000);
  assert.deepEqual(names(log), ['0.m4a', '1.m4a', '2.m4a', '0.m4a', '1.m4a', '2.m4a', '0.m4a']);
  // within one tick of the fake element (it moves in 250 ms steps)
  assert.ok(log.slice(1).every(([t], i) => t - log[i][0] >= 10_000 - TICK_MS && t - log[i][0] <= 10_000 + TICK_MS), 'each starts when the one before ends');
});

test('shuffled: every track once per round, a new order each round, never the same twice in a row', async () => {
  const a = show('a', 5, { order: 'shuffle' });
  let seed = 7;
  const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const { player, log, run } = setup({ lengths: lengthsOf(a), random });
  player.setShow(a);
  await run(20 * 10_300);
  const played = names(log);
  for (let r = 0; r + 5 <= played.length; r += 5) assert.equal(new Set(played.slice(r, r + 5)).size, 5, `round ${r / 5} has each track once`);
  assert.notDeepEqual(played.slice(0, 5), played.slice(5, 10), 'a new order each round');
  for (let i = 1; i < played.length; i++) assert.notEqual(played[i], played[i - 1], 'never the same track twice in a row');
});

test('crossfade: the next track starts fadeSeconds before the end, one fading in as the other fades out', async () => {
  const a = show('a', 2, { transition: 'crossfade', fadeSeconds: 3 });
  const { player, log, run, audible } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(8_500, 250);
  assert.equal(log.length, 2, 'the second track started before the first ended');
  assert.ok(log[1][0] >= 6_900 && log[1][0] <= 7_300, `at about 7 s (${log[1][0]})`);
  const both = audible();
  assert.equal(both.length, 2, 'both play during the fade');
  assert.ok(both.every((d) => d.volume > 0.2 && d.volume < 0.8), `half-way both are part-way (${JSON.stringify(both)})`);
  await run(3_000, 250);
  assert.deepEqual(audible().map((d) => d.volume), [1], 'after the fade only the new one, at full volume');
});

test('the show volume scales everything', async () => {
  const a = show('a', 1, { volume: 40 });
  const { player, run, audible } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(1_000);
  assert.deepEqual(audible().map((d) => d.volume), [0.4]);
});

test('switching shows uses the new show\'s transition: crossfade, or a cut', async () => {
  const a = show('a', 2);
  const b = show('b', 2, { transition: 'crossfade', fadeSeconds: 4 });
  const c = show('c', 2);
  const { player, run, audible } = setup({ lengths: lengthsOf(a, b, c) });
  player.setShow(a);
  await run(2_000);
  player.setShow(b);
  await run(2_000, 250);
  assert.equal(audible().length, 2, 'fading from a to b');
  await run(3_000, 250);
  assert.deepEqual(audible().map((d) => d.url.split('/')[2]), ['b'], 'then only b');
  player.setShow(c);
  await run(250, 250);
  assert.deepEqual(audible().map((d) => d.url.split('/')[2]), ['c'], 'no transition: c at once');
});

test('no show: the audio fades out, then stops', async () => {
  const a = show('a', 2);
  const { player, run, audible } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(2_000);
  player.setShow(null);
  await run(FADE_OUT_MS / 2, 250);
  assert.ok(audible()[0].volume < 1 && audible()[0].volume > 0, 'fading');
  await run(FADE_OUT_MS, 250);
  assert.deepEqual(audible(), [], 'silent');
});

test('the same show again changes nothing; coming back to a show plays its next track', async () => {
  const a = show('a', 3);
  const b = show('b', 2);
  const { player, log, run } = setup({ lengths: lengthsOf(a, b) });
  player.setShow(a);
  await run(12_000);   // a's second track playing
  player.setShow(JSON.parse(JSON.stringify(a)));
  await run(1_000);
  assert.deepEqual(names(log), ['0.m4a', '1.m4a'], 'nothing restarted');
  player.setShow(b);
  await run(3_000);
  player.setShow(a);
  await run(1_000);
  assert.equal(log[log.length - 1][1], '/audio/a/tracks/2.m4a', 'a carries on with the track after the one it left');
});

test('a track that can\'t be played is skipped; if none can, no busy loop', async () => {
  const a = show('a', 3);
  const { player, log, run } = setup({ lengths: lengthsOf(a), broken: new Set(['/audio/a/tracks/1.m4a']) });
  player.setShow(a);
  await run(10_000 + ERROR_WAIT_MS + 1_000);
  assert.deepEqual(names(log).slice(0, 2), ['0.m4a', '2.m4a'], 'the broken one is skipped');

  const b = show('b', 2);
  const all = setup({ lengths: lengthsOf(b), broken: new Set(b.tracks.map((t) => t.url)) });
  all.player.setShow(b);
  await all.run(10 * 60_000, 5_000);
  // Both tracks tried at first, then once a minute: no busy loop
  assert.ok(all.stats.plays >= 3 && all.stats.plays <= 2 + 11, `a try a minute (${all.stats.plays} in 10 minutes)`);
  assert.ok(!all.player.state().playing, 'nothing plays');
});

test('a track that stalls moves on at its length plus the grace', async () => {
  const a = show('a', 2);
  const { player, log, run } = setup({ lengths: lengthsOf(a), stalls: new Set(['/audio/a/tracks/0.m4a']) });
  player.setShow(a);
  await run(10_000 + STALL_GRACE_MS + 2_000);
  assert.equal(names(log)[1], '1.m4a', 'moved on');
  assert.ok(log[1][0] >= 10_000 + STALL_GRACE_MS && log[1][0] <= 10_000 + STALL_GRACE_MS + 1_500, `after length + grace (${log[1][0]})`);
});

test('the browser refuses to play: silent, then tries again every minute', async () => {
  let refusing = true;
  const a = show('a', 2);
  const { player, log, run } = setup({ lengths: lengthsOf(a), refuse: () => refusing });
  player.setShow(a);
  await run(5_000);
  assert.equal(player.state().blocked, true);
  assert.equal(log.length, 0);
  refusing = false;
  await run(RETRY_BLOCKED_MS);
  assert.equal(player.state().blocked, false, 'allowed now: playing');
  assert.equal(log.length, 1);
});

test('retryNow: a refused show plays at once when allowed (a click), and does nothing otherwise', async () => {
  let refusing = true;
  const a = show('a', 2);
  const { player, log, run, stats } = setup({ lengths: lengthsOf(a), refuse: () => refusing });
  player.setShow(a);
  await run(5_000);
  assert.equal(player.state().blocked, true);
  player.retryNow();   // still refused: blocked again, waiting a minute
  await run(1_000);
  assert.equal(player.state().blocked, true);
  refusing = false;
  player.retryNow();
  await run(1_000);
  assert.equal(player.state().blocked, false, 'playing straight away');
  assert.equal(log.length, 1);
  const plays = stats.plays;
  player.retryNow();   // playing: nothing to do
  await run(1_000);
  assert.equal(stats.plays, plays, 'no extra play');
  assert.equal(log.length, 1);
});

test('duck lowers the volume and brings it back; pause holds the track, resume carries on', async () => {
  const a = show('a', 2);
  const { player, log, run, audible, elements } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(2_000);
  player.duck(0.2, 500);
  await run(1_000, 250);
  assert.deepEqual(audible().map((d) => d.volume), [0.2]);
  player.duck(1, 500);
  await run(1_000, 250);
  assert.deepEqual(audible().map((d) => d.volume), [1]);
  player.pause();
  const at = elements.find((e) => e._src.endsWith('0.m4a')).currentTime;
  await run(30_000);
  assert.deepEqual(audible(), [], 'paused');
  player.resume();
  await run(1_000);
  assert.equal(names(log).length, 1, 'the same track, not a new one');
  assert.ok(elements.find((e) => e._src.endsWith('0.m4a')).currentTime > at, 'carrying on from where it was');
});

test('a day of shuffled crossfades keeps going without piling up timers', async () => {
  const a = show('a', 7, { order: 'shuffle', transition: 'crossfade', fadeSeconds: 2 });
  for (const t of a.tracks) t.length = 180;
  const { player, log, run, audible } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(24 * 60 * 60_000, 60_000);
  const expected = (24 * 60 * 60) / 178;
  assert.ok(Math.abs(log.length - expected) < 5, `about one track every 178 s (${log.length} vs ${expected.toFixed(0)})`);
  assert.ok(audible().length >= 1 && audible().length <= 2, 'still playing');
});
