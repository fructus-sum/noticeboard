// Tests for the display's slide clock, written for months of unattended running. Time is
// simulated: a fake scheduler jumps straight to the next due timer, so weeks of slides, sleeps,
// hidden pages, reconnects and outages run in seconds. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSlideshowClock,
  LOAD_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  GRACE_MS,
  RETRY_MS,
  OUTAGE_RETRY_MS,
  WATCHDOG_MS,
} from '../src/slideshowClock.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LOAD_MS = 100;       // how long the fake browser takes to show a slide
const VIDEO_MS = 20_000;   // length of the fake videos

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

// Plays the part of the browser. trouble(slide) decides how a slide misbehaves:
// null, 'never-loads', 'error', 'stall' (a video that freezes half way).
function setup(slides, { trouble = () => null } = {}) {
  const sched = createScheduler();
  const log = [];
  const stuck = [];
  let current = slides;
  let clock = null;
  const onChange = (state) => {
    assert.ok(state.index >= 0 && state.index < current.length, `index ${state.index} out of range`);
    if (log.length) assert.equal(state.generation, log[log.length - 1].generation + 1, 'generation skipped');
    log.push({ t: sched.now(), ...state });
    const slide = current[state.index];
    const gen = state.generation;
    const problem = trouble(slide, state);
    if (problem === 'never-loads') return;
    sched.timers.setTimeout(() => {
      if (problem === 'error') { clock.failed(gen); return; }
      clock.ready(gen);
      if (slide.type !== 'video') return;
      const stopAt = problem === 'stall' ? VIDEO_MS / 2 : VIDEO_MS;
      for (let t = 1_000; t <= stopAt; t += 1_000) sched.timers.setTimeout(() => clock.progress(gen), t);
      if (problem !== 'stall') sched.timers.setTimeout(() => clock.ended(gen), VIDEO_MS);
    }, LOAD_MS);
  };
  clock = createSlideshowClock({ onChange, onStuck: (n) => stuck.push(n), now: sched.now, timers: sched.timers });
  clock.start();
  const setSlides = (list) => { current = list; return clock.setSlides(list); };
  setSlides(slides);
  return { sched, clock, log, stuck, setSlides };
}

const images = (n, seconds = 3, tag = 'a') =>
  Array.from({ length: n }, (_, i) => ({ type: 'image', url: `/media/${tag}/${i}.png`, duration: seconds }));
const video = (tag = 'v') => ({ type: 'video', url: `/media/${tag}/clip.mp4`, duration: null });
const copy = (list) => JSON.parse(JSON.stringify(list));
// Time between each slide change after `from` and the change before it
const gapsAfter = (log, from) => {
  const gaps = [];
  for (let i = 1; i < log.length; i++) if (log[i].t > from) gaps.push(log[i].t - log[i - 1].t);
  return gaps;
};

test('cycles through the slides in order, each for its own duration', () => {
  const { sched, log } = setup(images(3, 3));
  sched.run(MINUTE);
  assert.deepEqual(log.slice(0, 7).map((e) => e.index), [0, 1, 2, 0, 1, 2, 0]);
  for (let i = 1; i < log.length; i++) assert.equal(log[i].t - log[i - 1].t, 3_000 + LOAD_MS);
});

test('the same playlist sent again never stops the slideshow, at any moment of a slide', () => {
  // The bug that froze screens: a re-sent playlist while the first slide was showing
  for (const offset of [0, 1, 50, 99, 100, 101, 1_500, 3_000, 3_099, 3_100, 3_101]) {
    const { sched, log, setSlides } = setup(images(3, 3));
    sched.run(offset);
    assert.equal(setSlides(copy(images(3, 3))), false, 'unchanged playlist should be ignored');
    const before = log.length;
    sched.run(MINUTE);
    assert.ok(log.length - before >= 18, `offset ${offset}: only ${log.length - before} changes in a minute`);
    assert.ok(Math.max(...gapsAfter(log, offset)) <= 3_000 + LOAD_MS, `offset ${offset}: a gap was too long`);
  }
});

test('a changed playlist starts from its first slide once the slide on screen has had its full time', () => {
  const { sched, log, setSlides } = setup(images(3, 3));
  sched.run(1_000);   // first slide on screen since LOAD_MS, due to change at LOAD_MS + 3 s
  const { generation, t } = log[log.length - 1];
  assert.equal(setSlides(images(4, 5, 'b')), true);
  assert.equal(log.length, 1, 'the slide on screen must not be cut short');
  sched.run(LOAD_MS + 3_000 - 1_000 - 1);
  assert.equal(log.length, 1, 'still the old slide until its time is up');
  sched.run(1);
  const next = log[log.length - 1];
  assert.equal(next.t - t, LOAD_MS + 3_000, 'the old slide kept its whole 3 s');
  assert.equal(next.index, 0);
  assert.equal(next.generation, generation + 1, 'must remount even though the index is still 0');
  sched.run(MINUTE);
  assert.ok(log.length >= 10);
  // The new playlist's own durations apply from its first slide on
  for (let i = 2; i < log.length; i++) assert.equal(log[i].t - log[i - 1].t, 5_000 + LOAD_MS);
});

test('a video on screen plays to its end before a new playlist starts', () => {
  const { sched, log, setSlides } = setup([video(), ...images(2, 3)]);
  sched.run(5_000);   // the video is playing
  setSlides(images(2, 4, 'b'));
  sched.run(VIDEO_MS - 5_000 + LOAD_MS - 1);
  assert.equal(log.length, 1, 'the video is still playing');
  sched.run(2);
  assert.equal(log[log.length - 1].t, VIDEO_MS + LOAD_MS, 'switched exactly when the video ended');
});

test('a changed playlist replaces a slide that is still loading, or stops when there is nothing left', () => {
  const loading = setup(images(3, 3));
  loading.sched.run(LOAD_MS / 2);   // first slide not on screen yet
  loading.setSlides(images(2, 3, 'b'));
  assert.equal(loading.log.length, 2, 'a slide that is not on screen yet is replaced at once');
  const emptied = setup(images(3, 3));
  emptied.sched.run(1_000);
  emptied.setSlides([]);
  assert.equal(emptied.clock.state().phase, 'idle', 'nothing left to show: stop at once');
  emptied.sched.run(MINUTE);
  assert.equal(emptied.log.length, 1);
});

test('going back to the running playlist before the switch cancels it', () => {
  const { sched, log, setSlides } = setup(images(3, 3));
  sched.run(1_000);
  setSlides(images(2, 3, 'b'));
  assert.equal(setSlides(images(3, 3)), true);
  sched.run(MINUTE);
  assert.deepEqual(log.slice(0, 4).map((e) => e.index), [0, 1, 2, 0], 'carried on with the first playlist');
  assert.ok(log.every((e) => e.generation > 0));
});

test('a slide that never loads is skipped once its load deadline passes', () => {
  const { sched, log } = setup(images(3, 3), { trouble: (s) => (s.url.endsWith('/1.png') ? 'never-loads' : null) });
  sched.run(2 * MINUTE);
  const stuckAt = log.findIndex((e) => e.index === 1);
  const gap = log[stuckAt + 1].t - log[stuckAt].t;
  assert.ok(gap >= LOAD_TIMEOUT_MS && gap <= LOAD_TIMEOUT_MS + WATCHDOG_MS + RETRY_MS, `gap ${gap}`);
  assert.equal(log[stuckAt + 1].index, 2);
});

test('a broken slide is skipped after a short pause', () => {
  const { sched, log } = setup(images(3, 3), { trouble: (s) => (s.url.endsWith('/1.png') ? 'error' : null) });
  sched.run(MINUTE);
  const at = log.findIndex((e) => e.index === 1);
  assert.equal(log[at + 1].t - log[at].t, LOAD_MS + RETRY_MS);
});

test('server unreachable: no busy loop, then an immediate restart when it is back', () => {
  let down = true;
  const { sched, clock, log, stuck } = setup(images(3, 3), { trouble: () => (down ? 'error' : null) });
  sched.run(10 * MINUTE);
  // One quick round, then one attempt every 30 s rather than hundreds
  assert.ok(log.length <= 3 + 10 * MINUTE / OUTAGE_RETRY_MS + 1, `${log.length} attempts in 10 minutes`);
  assert.ok(stuck.length >= 1, 'should report being stuck after three failed rounds');
  down = false;
  const before = log.length;
  clock.resume();   // the socket reconnected
  assert.equal(log.length, before + 1, 'should try the next slide straight away');
  sched.run(MINUTE);
  assert.ok(log.length - before >= 18, 'normal cycling should resume');
});

test('videos play to the end; stalled, unplayable or never-starting videos are skipped', () => {
  const run = (problem) => {
    const { sched, log } = setup([images(1, 3)[0], video(), images(1, 3, 'c')[0]], {
      trouble: (s) => (s.type === 'video' ? problem : null),
    });
    sched.run(3 * MINUTE);
    const at = log.findIndex((e) => e.index === 1);
    return log[at + 1].t - log[at].t;
  };
  assert.equal(run(null), LOAD_MS + VIDEO_MS);
  const stalled = run('stall');
  assert.ok(stalled >= LOAD_MS + VIDEO_MS / 2 + STALL_TIMEOUT_MS && stalled <= LOAD_MS + VIDEO_MS / 2 + STALL_TIMEOUT_MS + WATCHDOG_MS + RETRY_MS, `stall gap ${stalled}`);
  assert.equal(run('error'), LOAD_MS + RETRY_MS);
  const never = run('never-loads');
  assert.ok(never >= LOAD_TIMEOUT_MS && never <= LOAD_TIMEOUT_MS + WATCHDOG_MS + RETRY_MS, `never-starts gap ${never}`);
});

test('a lost timer cannot stop the slideshow: the watchdog moves on', () => {
  const { sched, log } = setup(images(3, 3));
  const realSetTimeout = sched.timers.setTimeout;
  let dropped = false;
  sched.timers.setTimeout = (fn, ms) => {
    if (!dropped && ms === 3_000) { dropped = true; return -1; }   // this slide's timer never fires
    return realSetTimeout(fn, ms);
  };
  sched.run(MINUTE);
  const gaps = log.slice(1).map((e, i) => e.t - log[i].t);
  const longest = Math.max(...gaps);
  assert.ok(longest > 3_000 + LOAD_MS && longest <= LOAD_MS + 3_000 + GRACE_MS + WATCHDOG_MS, `longest gap ${longest}`);
  assert.ok(log.length >= 15);
});

test('after the machine sleeps for 8 hours it moves on once on waking, with no burst', () => {
  const { sched, log } = setup(images(3, 3));
  sched.run(10_000);
  const before = log.length;
  sched.sleep(8 * HOUR);
  const wokeAt = sched.now();
  sched.run(50);
  assert.equal(log.length, before + 1, 'exactly one slide change right after waking');
  sched.run(MINUTE);
  const gaps = gapsAfter(log, wokeAt + 50);
  assert.ok(gaps.every((g) => g === 3_000 + LOAD_MS), 'normal pace after waking');
});

test('a hidden page with throttled timers catches up the moment it is visible again', () => {
  const { sched, clock, log } = setup(images(3, 3));
  sched.run(10_000);
  sched.throttle(true);            // tab hidden: timers at most once a minute
  sched.run(10 * MINUTE);
  const hiddenChanges = log.length;
  sched.throttle(false);           // visible again
  clock.resume();
  sched.run(0);
  sched.run(MINUTE);
  assert.ok(log.length - hiddenChanges >= 18, 'normal pace once visible');
});

test('events from a slide that has already been replaced are ignored', () => {
  const { sched, clock, log } = setup(images(3, 3));
  sched.run(1_000);
  const oldGen = log[log.length - 1].generation;
  sched.run(3_000 + LOAD_MS - 1_000);   // the exact moment the next slide starts loading
  assert.equal(clock.state().phase, 'loading');
  const state = clock.state();
  clock.ready(oldGen);
  clock.failed(oldGen);
  clock.ended(oldGen);
  clock.progress(oldGen);
  assert.deepEqual(clock.state(), state);
});

test('30 days unattended with reconnects, broken media, stalls, sleeps, hidden periods and outages', (t) => {
  // Small seeded random generator so a failure can be reproduced exactly
  let seed = 20260926;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let outage = false;
  let playlist = [...images(4, 3), video()];
  const { sched, clock, log, setSlides } = setup(playlist, {
    trouble: (s) => {
      if (outage) return 'error';
      const r = random();
      if (r < 0.01) return 'never-loads';
      if (r < 0.02) return 'error';
      if (s.type === 'video' && r < 0.07) return 'stall';
      return null;
    },
  });
  const quiet = [];   // [from, to]: asleep, hidden or server down, where long gaps are allowed
  const counts = { resends: 0, changes: 0, sleeps: 0, hidden: 0, outages: 0 };
  let maxPending = 0;
  for (let minute = 0; minute < 30 * DAY / MINUTE; minute++) {
    const r = random();
    if (r < 0.5 / 60) {                                          // reconnect: same playlist again
      counts.resends += 1;
      setSlides(copy(playlist));
    } else if (r < 0.5 / 60 + 1 / 1440) {                        // about daily: the playlist changes
      counts.changes += 1;
      playlist = random() < 0.5 && playlist.length > 2 ? playlist.slice(1) : [...playlist, images(1, 3, `m${minute}`)[0]];
      setSlides(playlist);
    } else if (r < 0.5 / 60 + 1 / 1440 + 0.02 / 60) {            // ~2% per hour: machine sleeps 1-8 h
      const ms = HOUR + Math.floor(random() * 7 * HOUR);
      counts.sleeps += 1;
      quiet.push([sched.now(), sched.now() + ms + 90_000]);
      sched.sleep(ms);
    } else if (r < 0.5 / 60 + 1 / 1440 + 0.07 / 60) {            // ~5% per hour: hidden 5-30 min
      const ms = 5 * MINUTE + Math.floor(random() * 25 * MINUTE);
      counts.hidden += 1;
      quiet.push([sched.now(), sched.now() + ms + 90_000]);
      sched.throttle(true);
      sched.run(ms);
      sched.throttle(false);
      clock.resume();
    } else if (r < 0.5 / 60 + 1 / 1440 + 0.08 / 60) {            // ~1% per hour: server down 1-10 min
      const ms = MINUTE + Math.floor(random() * 9 * MINUTE);
      counts.outages += 1;
      quiet.push([sched.now(), sched.now() + ms + 90_000]);
      outage = true;
      sched.run(ms);
      outage = false;
      clock.resume();
    }
    sched.run(MINUTE);
    maxPending = Math.max(maxPending, sched.pending());
  }
  const inQuiet = (t) => quiet.some(([from, to]) => t >= from && t <= to);
  let worst = 0;
  for (let i = 1; i < log.length; i++) {
    if (!inQuiet(log[i].t) && !inQuiet(log[i - 1].t)) worst = Math.max(worst, log[i].t - log[i - 1].t);
  }
  // Worst normal case: a video stalls near its end, then a whole-round failure pause
  const bound = VIDEO_MS + STALL_TIMEOUT_MS + WATCHDOG_MS + OUTAGE_RETRY_MS + GRACE_MS;
  t.diagnostic(`${log.length} slide changes; ${counts.resends} re-sent playlists, ${counts.changes} playlist changes, `
    + `${counts.sleeps} sleeps, ${counts.hidden} hidden periods, ${counts.outages} outages; `
    + `longest normal gap ${(worst / 1000).toFixed(1)} s (limit ${bound / 1000} s); at most ${maxPending} timers pending`);
  assert.ok(worst <= bound, `longest normal gap ${worst} ms > ${bound} ms`);
  assert.ok(log.length > 30 * DAY / (7_000) * 0.8, `only ${log.length} slide changes in 30 days`);
  assert.ok(maxPending <= 30, `timers piling up: ${maxPending} pending`);
  // And it is still cycling at the end
  const before = log.length;
  sched.run(5 * MINUTE);
  assert.ok(log.length - before >= 5, 'still cycling after 30 days');
});
