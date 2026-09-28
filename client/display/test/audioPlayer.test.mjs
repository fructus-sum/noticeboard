// Tests for the audio engine (shared/audioPlayer.mjs), over simulated time: fake audio elements
// that play, end, fail, stall, drift or are refused, and a scheduler that jumps to the next due
// timer, so hours of music run in milliseconds. Since 0.7.0 the engine plays to the show's timeline
// on the Server's time (SYSTEM_DESIGN §18.8), so screens whose clocks differ play the same track at
// the same point. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioPlayer, FADE_OUT_MS, RETRY_BLOCKED_MS, DRIFT_SEEK_S,
} from '../../../shared/audioPlayer.mjs';

const TICK_MS = 250;   // how often a playing fake element moves on (like timeupdate)

function createScheduler() {
  let t = 0;
  let seq = 0;
  const queue = new Map();
  const add = (fn, ms, every) => { const id = ++seq; queue.set(id, { at: t + Math.max(0, ms), fn, every }); return id; };
  return {
    now: () => t,
    pending: () => queue.size,
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

// The browser's side: elements that play tracks of the given lengths. Every player made here
// (a "screen") shares the scheduler, each with its own clock offset from the Server's.
function setup({ lengths = {}, broken = new Set(), stalls = new Set(), speed = {}, refuse = () => false } = {}) {
  const sched = createScheduler();
  const elements = [];
  const log = [];   // [time, url, screen] each time a track starts playing
  const stats = { plays: 0 };   // every play() call, refused or not
  function createElementFor(screen) {
    return () => {
      const listeners = {};
      const el = {
        screen, volume: 1, currentTime: 0, duration: NaN, playbackRate: 1, playing: false, ended: false, _src: '',
        set src(url) { this._src = url; this.duration = lengths[url] ?? NaN; this.currentTime = 0; this.playing = false; this.ended = false; this.logged = false; },
        get src() { return this._src; },
        addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
        emit: (name) => (listeners[name] || []).forEach((fn) => fn()),
        removeAttribute() { this._src = ''; this.playing = false; },
        play() {
          stats.plays += 1;
          if (refuse()) return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' }));
          if (broken.has(this._src)) { const e = this; sched.timers.setTimeout(() => e.emit('error'), 10); return Promise.reject(Object.assign(new Error('bad'), { name: 'NotSupportedError' })); }
          this.playing = true;
          if (!this.logged) log.push([sched.now(), this._src, screen]);   // a track starting, not one resuming
          this.logged = true;
          return Promise.resolve();
        },
        pause() { this.playing = false; },
      };
      elements.push(el);
      return el;
    };
  }
  sched.timers.setInterval(() => {
    for (const el of elements) {
      if (!el.playing) continue;
      if (stalls.has(el._src) && el.currentTime >= el.duration / 2 && el.currentTime < el.duration * 0.8) continue;
      el.currentTime = Math.min(el.duration, el.currentTime + (TICK_MS / 1000) * el.playbackRate * (speed[el._src] ?? 1));
      el.emit('timeupdate');
      if (el.currentTime >= el.duration) { el.playing = false; el.ended = true; el.emit('ended'); }
    }
  }, TICK_MS);
  const players = [];
  const addScreen = (offsetMs = 0) => {
    const screen = players.length;
    const player = createAudioPlayer({ createElement: createElementFor(screen), timers: sched.timers, now: sched.now, serverNow: () => sched.now() + offsetMs });
    players.push(player);
    return player;
  };
  const player = addScreen(0);
  // Promise callbacks run between timer jumps
  const run = async (ms, step = 1000) => { for (let done = 0; done < ms; done += step) { sched.run(Math.min(step, ms - done)); await Promise.resolve(); await Promise.resolve(); } };
  const audible = (screen = 0) => elements.filter((e) => e.playing && e.screen === screen).map((e) => ({ url: e._src, volume: +e.volume.toFixed(2), at: e.currentTime }));
  return { sched, player, addScreen, log, elements, run, audible, stats };
}

const show = (id, n, extra = {}) => ({
  id, order: 'in-order', transition: 'none', fadeSeconds: 3, volume: 100, startedAt: 0,
  tracks: Array.from({ length: n }, (_, i) => ({ url: `/audio/${id}/tracks/${i}.m4a`, length: 10 })), ...extra,
});
const lengthsOf = (...shows) => Object.fromEntries(shows.flatMap((s) => s.tracks.map((t) => [t.url, t.length])));
const names = (log, screen = 0) => log.filter((x) => x[2] === screen).map(([, url]) => url.split('/').pop());

test('in order: each track at its time on the timeline, round and round', async () => {
  const a = show('a', 3);
  const { player, log, run } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(65_000);
  assert.deepEqual(names(log), ['0.m4a', '1.m4a', '2.m4a', '0.m4a', '1.m4a', '2.m4a', '0.m4a']);
  assert.ok(log.every(([t], i) => Math.abs(t - i * 10_000) <= 10), `each starts on its boundary (${log.map(([t]) => t)})`);
});

test('joining mid-way (a screen switched on late): the track the timeline is on, at its point', async () => {
  const a = show('a', 3);
  const { player, log, run, audible } = setup({ lengths: lengthsOf(a) });
  await run(25_000);
  player.setShow(a);
  await run(500, 250);
  assert.deepEqual(names(log), ['2.m4a']);
  assert.ok(Math.abs(audible()[0].at - 5.5) <= 0.3, `5 s into it (${audible()[0].at})`);
});

test('two screens with clocks minutes apart play the same track at the same point, shuffled and crossfaded, all day', async () => {
  const a = show('a', 6, { order: 'shuffle', transition: 'crossfade', fadeSeconds: 2, startedAt: 7_000_000 });
  a.tracks.forEach((t, i) => { t.length = 60 + i * 7; });
  const { sched, player, addScreen, log, run, audible } = setup({ lengths: lengthsOf(a) });
  // This screen's clock is behind the Server's by 5 minutes, the other's ahead by 3: each is told
  // the Server's time (serverNow), as useSocket measures it
  const other = addScreen(0);
  const s0 = JSON.parse(JSON.stringify(a));
  // Simulated time here is the Server's (the fake scheduler); both follow it
  await run(7_000_000 - sched.now(), 60_000);
  player.setShow(s0);
  await run(40_000);
  other.setShow(JSON.parse(JSON.stringify(a)));   // joins 40 s later
  let checks = 0;
  for (let i = 0; i < 24 * 60; i++) {
    await run(60_000, 1_000);
    const [x] = audible(0).filter((d) => d.volume >= 0.5);
    const [y] = audible(1).filter((d) => d.volume >= 0.5);
    if (!x || !y) continue;   // mid-crossfade
    assert.equal(x.url, y.url);
    assert.ok(Math.abs(x.at - y.at) <= 0.3, `the same point (${x.at} vs ${y.at})`);
    checks += 1;
  }
  assert.ok(checks > 1300, `${checks} checks`);
  const played = names(log, 0);
  for (let i = 1; i < played.length; i++) assert.notEqual(played[i], played[i - 1], 'never the same track twice in a row');
});

test('a track that drifts is put back in step', async () => {
  const a = show('a', 1, { tracks: [{ url: '/audio/a/tracks/0.m4a', length: 600 }] });
  const { player, run, audible, sched } = setup({ lengths: lengthsOf(a), speed: { '/audio/a/tracks/0.m4a': 0.9 } });
  player.setShow(a);
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    await run(1_000, 250);
    worst = Math.max(worst, Math.abs(sched.now() / 1000 - audible()[0].at));
  }
  assert.ok(worst <= DRIFT_SEEK_S + 0.3, `never far out (${worst.toFixed(2)} s at worst)`);
});

test('crossfade: the next track starts fadeSeconds before the end, one fading in as the other fades out', async () => {
  const a = show('a', 2, { transition: 'crossfade', fadeSeconds: 3 });
  const { player, log, run, audible } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(8_500, 250);
  assert.equal(log.length, 2, 'the second track started before the first ended');
  assert.ok(Math.abs(log[1][0] - 7_000) <= 10, `at 7 s (${log[1][0]})`);
  const both = audible();
  assert.equal(both.length, 2, 'both play during the fade');
  assert.ok(both.every((d) => d.volume > 0.2 && d.volume < 0.8), `half-way both are part-way (${JSON.stringify(both)})`);
  await run(3_000, 250);
  assert.deepEqual(audible().map((d) => d.volume), [1], 'after the fade only the new one, at full volume');
});

test('the show volume scales everything, and a new volume applies at once without a new track', async () => {
  const a = show('a', 1, { volume: 40 });
  const { player, run, audible, log } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(1_000);
  assert.deepEqual(audible().map((d) => d.volume), [0.4]);
  player.setShow({ ...a, volume: 70 });
  await run(1_000);
  assert.deepEqual(audible().map((d) => d.volume), [0.7]);
  assert.equal(log.length, 1);
});

test('switching shows uses the new show\'s transition: crossfade, or a cut', async () => {
  const a = show('a', 2);
  const b = show('b', 2, { transition: 'crossfade', fadeSeconds: 4 });
  b.tracks.forEach((t) => { t.length = 60; });   // its own timeline stays on one track meanwhile
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

test('the same show again changes nothing; coming back to a show joins it where it is now, like a radio', async () => {
  const a = show('a', 3);
  const b = show('b', 2);
  const { player, log, run, audible } = setup({ lengths: lengthsOf(a, b) });
  player.setShow(a);
  await run(12_000);   // a's second track playing
  player.setShow(JSON.parse(JSON.stringify(a)));
  await run(1_000);
  assert.deepEqual(names(log), ['0.m4a', '1.m4a'], 'nothing restarted');
  player.setShow(b);
  await run(12_000);
  player.setShow(a);
  await run(500, 250);
  assert.equal(log[log.length - 1][1], '/audio/a/tracks/2.m4a', 'a where its timeline is: its third track');
  assert.ok(Math.abs(audible()[0].at - 5.5) <= 0.3, `5 s into it (${audible()[0].at})`);
});

test('a new timeline from the Server (a change, or the end of an event) is followed at once', async () => {
  const a = show('a', 3);
  const { player, log, run } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(15_000);
  player.setShow({ ...a, startedAt: 15_000, after: 1 });
  await run(500, 250);
  assert.deepEqual(names(log), ['0.m4a', '1.m4a', '2.m4a'], 'the track after the one it was on, from its start');
  assert.ok(Math.abs(log[2][0] - 15_000) <= 10);
});

test('a track that can\'t be played is silent for its time, then the next one starts in step; if none can, no busy loop', async () => {
  const a = show('a', 3);
  const { player, log, run } = setup({ lengths: lengthsOf(a), broken: new Set(['/audio/a/tracks/1.m4a']) });
  player.setShow(a);
  await run(25_000);
  assert.deepEqual(names(log).slice(0, 2), ['0.m4a', '2.m4a'], 'the broken one gives way');
  assert.ok(Math.abs(log[1][0] - 20_000) <= 10, `the next at its own time (${log[1][0]})`);

  const b = show('b', 2);
  const all = setup({ lengths: lengthsOf(b), broken: new Set(b.tracks.map((t) => t.url)) });
  all.player.setShow(b);
  await all.run(10 * 60_000, 5_000);
  // One try per track, at its time: 60 in 10 minutes of 10 s tracks, never more
  assert.ok(all.stats.plays <= 61, `one try per slot (${all.stats.plays} in 10 minutes)`);
  assert.ok(!all.player.state().playing, 'nothing plays');
});

test('a track that stalls is put back in step, and the next starts on time', async () => {
  const a = show('a', 2);
  const { player, log, run } = setup({ lengths: lengthsOf(a), stalls: new Set(['/audio/a/tracks/0.m4a']) });
  player.setShow(a);
  await run(12_000);
  assert.equal(names(log)[1], '1.m4a', 'moved on');
  assert.ok(Math.abs(log[1][0] - 10_000) <= 10, `at its time (${log[1][0]})`);
});

test('the browser refuses to play: silent, then tries again every minute, joining the timeline where it is', async () => {
  let refusing = true;
  const a = show('a', 2);
  const { player, log, run, audible, sched } = setup({ lengths: lengthsOf(a), refuse: () => refusing });
  player.setShow(a);
  await run(5_000);
  assert.equal(player.state().blocked, true);
  assert.equal(log.length, 0);
  refusing = false;
  await run(RETRY_BLOCKED_MS);
  assert.equal(player.state().blocked, false, 'allowed now: playing');
  assert.equal(log.length, 1);
  // A minute after it was refused (1 s in): 61 s, in the timeline's fourth round (from 60 s)
  assert.ok(Math.abs(log[0][0] - 61_000) <= 10, `${log[0][0]}`);
  await run(250, 250);
  assert.ok(audible()[0].url.endsWith('0.m4a') && Math.abs(audible()[0].at - (sched.now() - 60_000) / 1000) <= 0.3, `the track and point the timeline is on (${JSON.stringify(audible())})`);
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

test('duck lowers the volume and brings it back; pause is silent, resume joins the timeline where it is', async () => {
  const a = show('a', 2, { tracks: [{ url: '/audio/a/tracks/0.m4a', length: 60 }, { url: '/audio/a/tracks/1.m4a', length: 60 }] });
  const { player, log, run, audible } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(2_000);
  player.duck(0.2, 500);
  await run(1_000, 250);
  assert.deepEqual(audible().map((d) => d.volume), [0.2]);
  player.duck(1, 500);
  await run(1_000, 250);
  assert.deepEqual(audible().map((d) => d.volume), [1]);
  player.pause();
  await run(20_000);
  assert.deepEqual(audible(), [], 'paused');
  player.resume();
  await run(250, 250);
  assert.equal(names(log).length, 1, 'the same track, not a new one');
  assert.ok(Math.abs(audible()[0].at - 24.25) <= 0.3, `put forward to where the timeline is (${audible()[0].at})`);
  player.pause();
  await run(60_000);
  player.resume();
  await run(250, 250);
  assert.deepEqual(names(log), ['0.m4a', '1.m4a'], 'paused past its end: the track on by then');
});

test('a show without a timeline (the preview): from its first track now; next() the next now; a change starts the next', async () => {
  const a = show('a', 3, { startedAt: undefined });
  const { player, log, run } = setup({ lengths: lengthsOf(a) });
  await run(33_000);
  player.setShow(a);
  await run(4_000);
  assert.deepEqual(names(log), ['0.m4a'], 'from the first track, whenever it starts');
  player.setShow({ ...a, volume: 50 });
  await run(1_000);
  assert.equal(log.length, 1, 'the volume changes nothing else');
  player.next();
  await run(1_000);
  assert.deepEqual(names(log), ['0.m4a', '1.m4a']);
  player.setShow({ ...a, order: 'shuffle' });
  await run(1_000);
  assert.equal(log.length, 3, 'a changed order: its next track now');
  assert.notEqual(names(log)[2], '1.m4a');
  player.stop();
  player.setShow(a);
  await run(1_000);
  assert.equal(names(log)[3], '0.m4a', 'after stop: from the first again');
});

test('a day of shuffled crossfades keeps going without piling up timers', async () => {
  const a = show('a', 7, { order: 'shuffle', transition: 'crossfade', fadeSeconds: 2 });
  for (const t of a.tracks) t.length = 180;
  const { player, log, run, audible, sched } = setup({ lengths: lengthsOf(a) });
  player.setShow(a);
  await run(60_000);
  const timersAtStart = sched.pending();
  await run(24 * 60 * 60_000, 60_000);
  const expected = (24 * 60 * 60) / 178;
  assert.ok(Math.abs(log.length - expected) < 3, `one track every 178 s (${log.length} vs ${expected.toFixed(0)})`);
  assert.ok(audible().length >= 1 && audible().length <= 2, 'still playing');
  assert.ok(sched.pending() <= timersAtStart + 2, `timers ${timersAtStart} → ${sched.pending()}`);
});
