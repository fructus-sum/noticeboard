// Tests for the display's slide clock, written for months of unattended running and, since 0.7.0,
// for screens in step with each other (SYSTEM_DESIGN §18.8). Time is simulated: a fake scheduler
// jumps straight to the next due timer, so weeks of slides, sleeps, hidden pages, reconnects and
// outages run in seconds. The scheduler's time is the Server's; a screen's estimate of it can be a
// little off (err), as a real one is. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlideshowClock, WATCHDOG_MS } from '../src/slideshowClock.js';
import { positionAt, boundaryAfter } from '../../../shared/slideTimeline.mjs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LOAD_MS = 100;       // how long the fake browser takes to show a slide

// Timers that only move when the test says so. sleep() is a suspended machine: nothing runs,
// then overdue timers fire once. throttle() is a hidden tab: timers run at most once a minute,
// and when it ends they're due at their real times again, as in Chrome.
function createScheduler() {
  let now = 0;
  let seq = 0;
  let throttled = false;
  const queue = new Map();
  const align = (t) => (throttled ? Math.ceil(t / MINUTE) * MINUTE : t);
  const add = (fn, ms, period) => {
    const due = now + Math.max(0, ms);
    const id = ++seq;
    queue.set(id, { due, at: align(due), fn, period, every: throttled && period ? Math.max(period, MINUTE) : period });
    return id;
  };
  return {
    now: () => now,
    timers: {
      setTimeout: (fn, ms) => add(fn, ms, 0),
      clearTimeout: (id) => queue.delete(id),
      setInterval: (fn, ms) => add(fn, ms, ms),
      clearInterval: (id) => queue.delete(id),
    },
    run(ms) {
      const end = now + ms;
      for (;;) {
        let id = null;
        let due = null;
        for (const [key, t] of queue) {
          if (t.at <= end && (due === null || t.at < due.at)) { id = key; due = t; }
        }
        if (!due) break;
        now = Math.max(now, due.at);
        if (due.every) {
          due.due = now + due.every;
          due.at = align(due.due);
        } else {
          queue.delete(id);
        }
        due.fn();
      }
      now = end;
    },
    sleep(ms) {
      now += ms;
      for (const t of queue.values()) if (t.every && t.at < now) t.at = now;
    },
    throttle(on) {
      throttled = on;
      for (const t of queue.values()) {
        if (t.period) t.every = on ? Math.max(t.period, MINUTE) : t.period;
        t.at = on ? align(t.due) : Math.max(now, t.due);
      }
    },
    pending: () => queue.size,
  };
}

// A screen: its clock, and the browser's side. trouble(slide) says how a slide misbehaves: null,
// 'never-loads' or 'error'. err is how far off its estimate of the Server's time is (ms).
function screen(sched, { err = 0, trouble = () => null } = {}) {
  const log = [];
  const stuck = [];
  let current = [];
  let clock = null;
  const onChange = (state) => {
    assert.ok(state.index >= 0 && state.index < current.length, `index ${state.index} out of range`);
    if (log.length) assert.equal(state.generation, log[log.length - 1].generation + 1, 'generation skipped');
    log.push({ t: sched.now(), ...state });
    const gen = state.generation;
    const problem = trouble(current[state.index]);
    if (problem === 'never-loads') return;
    sched.timers.setTimeout(() => (problem === 'error' ? clock.failed(gen) : clock.ready(gen)), LOAD_MS);
  };
  clock = createSlideshowClock({ onChange, onStuck: (n) => stuck.push(n), serverNow: () => sched.now() + err, timers: sched.timers });
  clock.start();
  const setSlides = (list, startedAt) => { current = list; return clock.setSlides(list, startedAt); };
  const onNow = () => clock.state().index;
  return { clock, log, stuck, setSlides, onNow };
}

const images = (n, seconds = 3, tag = 'a') =>
  Array.from({ length: n }, (_, i) => ({ type: 'image', url: `/media/${tag}/${i}.png`, duration: seconds }));
const video = (length = 20, tag = 'v') => ({ type: 'video', url: `/media/${tag}/clip.mp4`, duration: null, length });
const copy = (list) => JSON.parse(JSON.stringify(list));

test('cycles through the slides in order, each for its own time, from the playlist\'s start', () => {
  const sched = createScheduler();
  const s = screen(sched);
  s.setSlides(images(3, 3), 0);
  sched.run(20_000);
  // Each change at its boundary, or a few ms after (whichever of the slide's timer and the watchdog comes first)
  assert.deepEqual(s.log.map((e) => e.index), [0, 1, 2, 0, 1, 2, 0]);
  s.log.forEach((e, i) => assert.ok(e.t >= i * 3_000 && e.t <= i * 3_000 + 5, `change ${i} at ${e.t}`));
});

test('the same playlist sent again never restarts the slide on screen, at any moment', () => {
  const sched = createScheduler();
  const s = screen(sched);
  const list = images(3, 3);
  s.setSlides(list, 0);
  for (const at of [0, 50, 1_000, 2_999, 3_010, 7_777]) {
    sched.run(at - sched.now());
    const before = s.log.length;
    assert.equal(s.setSlides(copy(list), 0), false);
    assert.equal(s.log.length, before, `re-sent at ${at}`);
  }
});

test('a changed playlist (the Server sends it at a boundary) is followed at once, from its first slide', () => {
  const sched = createScheduler();
  const s = screen(sched);
  s.setSlides(images(3, 3), 0);
  sched.run(6_000);                         // the boundary the Server picked
  s.setSlides(images(2, 5, 'b'), 6_000);
  const last = s.log[s.log.length - 1];
  assert.equal(last.t, 6_000);
  assert.equal(last.index, 0);
  assert.equal(last.slotStart, 6_000);
  sched.run(5_010);
  assert.equal(s.onNow(), 1, 'then its own timeline');
});

test('a screen that joins late goes straight to the slide on air, and a video to the right point', () => {
  const sched = createScheduler();
  sched.run(47_300);                        // the playlist started 47.3 s ago
  const s = screen(sched);
  s.setSlides([...images(2, 10), video(30)], 0);   // 50 s a round: at 47.3 s, 27.3 s into the video
  const first = s.log[0];
  assert.equal(first.index, 2);
  assert.equal(first.slotStart, 20_000);
  assert.ok(Math.abs(first.offset - 27.3) < 0.001, `offset ${first.offset}`);
});

test('two screens whose estimates of the Server\'s time differ slightly show the same slide, round after round', () => {
  const sched = createScheduler();
  const a = screen(sched, { err: -30 });
  const b = screen(sched, { err: 45 });
  const list = [...images(3, 4), video(12)];
  a.setSlides(list, 0);
  b.setSlides(list, 0);
  let disagreements = 0;
  for (let t = 0; t < 10 * MINUTE; t += 250) {
    sched.run(250);
    const truth = positionAt(list, 0, sched.now()).index;
    // Within 50 ms of a boundary the two may legitimately differ
    const nearEdge = [0, 4_000, 8_000, 12_000].some((edge) => Math.abs(((sched.now() % 24_000) - edge + 24_000) % 24_000) < 80
      || Math.abs(((sched.now() % 24_000) - edge)) < 80);
    if (!nearEdge && (a.onNow() !== truth || b.onNow() !== truth)) disagreements += 1;
  }
  assert.equal(disagreements, 0);
});

test('a slide that can\'t be shown keeps its place until its time is up', () => {
  const sched = createScheduler();
  const s = screen(sched, { trouble: (slide) => (slide.url.endsWith('/1.png') ? 'error' : slide.url.endsWith('/2.png') ? 'never-loads' : null) });
  s.setSlides(images(4, 3), 0);
  sched.run(12_100);
  assert.deepEqual(s.log.map((e) => e.index), [0, 1, 2, 3, 0], 'no slide skipped early');
  s.log.forEach((e, i) => assert.ok(e.t >= i * 3_000 && e.t <= i * 3_000 + 5, `change ${i} at ${e.t}`));
});

test('when every slide keeps failing (the server gone), the recovery is asked for after three rounds', () => {
  const sched = createScheduler();
  let broken = true;
  const s = screen(sched, { trouble: () => (broken ? 'error' : null) });
  s.setSlides(images(2, 3), 0);
  sched.run(6 * 3_000 + 10);
  assert.deepEqual(s.stuck, [6]);
  broken = false;
  sched.run(30_000);
  assert.deepEqual(s.stuck, [6], 'working again: no more');
});

test('a lost timer cannot stop the slideshow: the watchdog catches up', () => {
  const sched = createScheduler();
  const s = screen(sched);
  const realSetTimeout = sched.timers.setTimeout;
  let dropped = false;
  sched.timers.setTimeout = (fn, ms) => {
    if (!dropped && ms > 2_000) { dropped = true; return -1; }   // this slide's end timer never fires
    return realSetTimeout(fn, ms);
  };
  s.setSlides(images(3, 3), 0);
  sched.run(MINUTE);
  const gaps = s.log.slice(1).map((e, i) => e.t - s.log[i].t);
  assert.ok(Math.max(...gaps) <= 3_000 + WATCHDOG_MS + 10, `longest gap ${Math.max(...gaps)}`);
  assert.equal(s.onNow(), positionAt(images(3, 3), 0, sched.now()).index, 'and on the right slide');
});

test('after the machine sleeps for 8 hours it goes straight to the right slide, once, with no burst', () => {
  const sched = createScheduler();
  const s = screen(sched);
  const list = images(3, 3);
  s.setSlides(list, 0);
  sched.run(10_000);
  const before = s.log.length;
  sched.sleep(8 * HOUR + 1_234);
  sched.run(0);
  assert.equal(s.log.length, before + 1, 'exactly one change on waking');
  assert.equal(s.onNow(), positionAt(list, 0, sched.now()).index);
  const woke = sched.now();
  sched.run(MINUTE);
  const gaps = s.log.filter((e) => e.t > woke + 3_000).map((e, i, all) => (i ? e.t - all[i - 1].t : 3_000));
  assert.ok(gaps.every((g) => g === 3_000), 'normal pace after waking');
});

test('a hidden page with throttled timers is on the right slide the moment it is visible again', () => {
  const sched = createScheduler();
  const s = screen(sched);
  const list = images(3, 3);
  s.setSlides(list, 0);
  sched.run(10_000);
  sched.throttle(true);
  sched.run(10 * MINUTE + 1_700);
  sched.throttle(false);
  s.clock.resume();
  assert.equal(s.onNow(), positionAt(list, 0, sched.now()).index);
});

test('events from a slide that has already been replaced are ignored', () => {
  const sched = createScheduler();
  const s = screen(sched);
  s.setSlides(images(3, 3), 0);
  sched.run(1_000);
  const oldGen = s.log[s.log.length - 1].generation;
  sched.run(2_100);
  const state = s.clock.state();
  s.clock.ready(oldGen);
  s.clock.failed(oldGen);
  s.clock.ended(oldGen);
  s.clock.progress(oldGen);
  assert.deepEqual(s.clock.state(), state);
});

test('a playlist without a start time (an older server) starts when it arrives', () => {
  const sched = createScheduler();
  sched.run(5_000);
  const s = screen(sched);
  s.setSlides(images(2, 3));
  assert.equal(s.clock.state().startedAt, 5_000);
  assert.equal(s.log[0].index, 0);
});

test('30 days unattended, two screens, with reconnects, playlist changes, failures, sleeps, hidden periods and outages', (t) => {
  // Small seeded random generator so a failure can be reproduced exactly
  let seed = 20260928;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const sched = createScheduler();
  let outage = false;
  const trouble = (slide) => {
    if (outage) return 'error';
    const r = random();
    if (r < 0.01) return 'never-loads';
    if (r < 0.02) return 'error';
    return null;
  };
  const a = screen(sched, { err: -25, trouble });
  const b = screen(sched, { err: 40, trouble });
  let playlist = [...images(4, 3), video(20)];
  let startedAt = 0;
  a.setSlides(playlist, startedAt);
  b.setSlides(playlist, startedAt);
  const quiet = [];   // [from, to]: asleep or hidden, where a screen may lag
  const counts = { resends: 0, changes: 0, sleeps: 0, hidden: 0, outages: 0 };
  let checked = 0;
  let wrong = 0;
  let maxPending = 0;
  for (let minute = 0; minute < 30 * DAY / MINUTE; minute++) {
    const r = random();
    const who = random() < 0.5 ? a : b;
    if (r < 0.5 / 60) {                                          // a reconnect: the same playlist again
      counts.resends += 1;
      who.setSlides(copy(playlist), startedAt);
    } else if (r < 0.5 / 60 + 1 / 1440) {                        // about daily: the playlist changes at a boundary
      counts.changes += 1;
      const at = boundaryAfter(playlist, startedAt, sched.now());
      sched.run(at - sched.now());
      playlist = random() < 0.5 && playlist.length > 2 ? playlist.slice(1) : [...playlist, images(1, 3, `m${minute}`)[0]];
      startedAt = at;
      a.setSlides(playlist, startedAt);
      b.setSlides(playlist, startedAt);
    } else if (r < 0.5 / 60 + 1 / 1440 + 0.02 / 60) {            // ~2% per hour: a machine sleeps 1-8 h
      const ms = HOUR + Math.floor(random() * 7 * HOUR);
      counts.sleeps += 1;
      quiet.push([sched.now(), sched.now() + ms + WATCHDOG_MS]);
      sched.sleep(ms);
    } else if (r < 0.5 / 60 + 1 / 1440 + 0.07 / 60) {            // ~5% per hour: hidden 5-30 min
      const ms = 5 * MINUTE + Math.floor(random() * 25 * MINUTE);
      counts.hidden += 1;
      quiet.push([sched.now(), sched.now() + ms]);
      sched.throttle(true);
      sched.run(ms);
      sched.throttle(false);
      a.clock.resume();
      b.clock.resume();
    } else if (r < 0.5 / 60 + 1 / 1440 + 0.08 / 60) {            // ~1% per hour: server down 1-10 min
      const ms = MINUTE + Math.floor(random() * 9 * MINUTE);
      counts.outages += 1;
      outage = true;
      sched.run(ms);
      outage = false;
    }
    // Check both screens against the timeline at a random moment in the next minute
    const step = 1_000 + Math.floor(random() * 58_000);
    sched.run(step);
    const truth = positionAt(playlist, startedAt, sched.now());
    const nearEdge = sched.now() - truth.start < 100 || truth.end - sched.now() < 100;
    if (!nearEdge && !quiet.some(([from, to]) => sched.now() >= from && sched.now() <= to)) {
      checked += 1;
      if (a.onNow() !== truth.index || b.onNow() !== truth.index) wrong += 1;
    }
    sched.run(MINUTE - step);
    maxPending = Math.max(maxPending, sched.pending());
  }
  t.diagnostic(`${a.log.length} + ${b.log.length} slide changes; ${counts.resends} re-sent playlists, ${counts.changes} playlist changes, `
    + `${counts.sleeps} sleeps, ${counts.hidden} hidden periods, ${counts.outages} outages; ${checked} checks, ${wrong} off the timeline; `
    + `at most ${maxPending} timers pending`);
  assert.equal(wrong, 0, 'both screens on the slide the timeline says');
  assert.ok(checked > 40_000, `only ${checked} checks`);
  assert.ok(maxPending <= 20, `timers piling up: ${maxPending} pending`);
  const before = a.log.length;
  sched.run(5 * MINUTE);
  assert.ok(a.log.length - before >= 5, 'still cycling after 30 days');
});
