// Tests for the music timeline (shared/musicTimeline.mjs): the track every screen plays at a given
// moment of the Server's time. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicAt, sequence, slotMs, UNKNOWN_TRACK_SECONDS } from '../../../shared/musicTimeline.mjs';

const show = (over = {}) => ({
  id: 'music', order: 'in-order', transition: 'none', fadeSeconds: 3, volume: 80, startedAt: 1_000_000,
  tracks: [{ url: 'a', length: 10 }, { url: 'b', length: 20 }, { url: 'c', length: 30 }],
  ...over,
});

test('in order: each track for its length, round and round', () => {
  const s = show();
  assert.deepEqual(musicAt(s, 1_000_000), { track: 0, start: 1_000_000, end: 1_010_000, round: 0 });
  assert.deepEqual(musicAt(s, 1_015_000), { track: 1, start: 1_010_000, end: 1_030_000, round: 0 });
  assert.deepEqual(musicAt(s, 1_059_999), { track: 2, start: 1_030_000, end: 1_060_000, round: 0 });
  assert.deepEqual(musicAt(s, 1_060_000), { track: 0, start: 1_060_000, end: 1_070_000, round: 1 });
  // A week on, still exactly on the timeline
  const week = 7 * 24 * 3_600_000;
  const at = musicAt(s, 1_000_000 + week + 12_000);
  assert.equal((at.start - 1_000_000) % 60_000, 10_000);
  assert.equal(at.track, 1);
  // Before it started: the first track, from its start
  assert.deepEqual(musicAt(s, 0), { track: 0, start: 1_000_000, end: 1_010_000, round: 0 });
  assert.equal(musicAt(show({ tracks: [] }), 5), null);
});

test('in order after a track: the timeline starts with the next one', () => {
  assert.deepEqual(sequence(show({ after: 1 }), 0), [2, 0, 1]);
  assert.deepEqual(sequence(show({ after: 2 }), 5), [0, 1, 2]);
  assert.deepEqual(sequence(show({ after: 7 }), 0), [0, 1, 2]);   // no such track: from the first
  assert.equal(musicAt(show({ after: 0 }), 1_000_000).track, 1);
});

test('a crossfade starts the next track fadeSeconds before the end; a short track plays to its end', () => {
  const s = show({ transition: 'crossfade', fadeSeconds: 4, tracks: [{ url: 'a', length: 10 }, { url: 'b', length: 6 }] });
  assert.equal(slotMs(s, 0), 6_000);    // 10 s less the 4 s fade
  assert.equal(slotMs(s, 1), 6_000);    // shorter than two fades: to its end
  assert.deepEqual(musicAt(s, 1_006_000), { track: 1, start: 1_006_000, end: 1_012_000, round: 0 });
  // A track without a known length
  assert.equal(slotMs(show({ tracks: [{ url: 'x', length: null }] }), 0), UNKNOWN_TRACK_SECONDS * 1000);
});

test('shuffled: the same order on every screen, a new one each round, never the same track twice in a row', () => {
  const tracks = Array.from({ length: 6 }, (_, i) => ({ url: `t${i}`, length: 5 + i }));
  const s = show({ order: 'shuffle', tracks });
  // Two screens compute it separately (a copy of the show, as each receives it)
  const other = JSON.parse(JSON.stringify(s));
  let previous = null;
  let differentRounds = 0;
  for (let round = 0; round < 500; round++) {
    const order = sequence(s, round);
    assert.deepEqual(order, sequence(other, round));
    assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5]);
    assert.notEqual(order[0], previous);
    if (round > 0 && JSON.stringify(order) !== JSON.stringify(sequence(s, round - 1))) differentRounds += 1;
    previous = order[order.length - 1];
  }
  assert.ok(differentRounds > 450, `${differentRounds} of 499 rounds drew a new order`);
  // Another start (a re-anchored timeline) draws another order
  assert.notDeepEqual([0, 1, 2, 3].map((r) => sequence(s, r)), [0, 1, 2, 3].map((r) => sequence({ ...s, startedAt: 2_000_000 }, r)));
  // Never `after` first
  for (let a = 0; a < 6; a++) {
    for (let t = 0; t < 40; t++) assert.notEqual(sequence({ ...s, startedAt: 5_000 + t, after: a }, 0)[0], a);
  }
  // Two tracks take turns
  const two = show({ order: 'shuffle', tracks: tracks.slice(0, 2) });
  assert.deepEqual([musicAt(two, 1_000_000).track, musicAt(two, 1_005_000).track, musicAt(two, 1_011_000).track], [0, 1, 0]);
});

test('two screens asking at any moment of a simulated day agree on the track and the point in it', () => {
  const tracks = Array.from({ length: 9 }, (_, i) => ({ url: `t${i}`, length: 60 + i * 17.3 }));
  const s = show({ order: 'shuffle', transition: 'crossfade', fadeSeconds: 5, tracks });
  const other = JSON.parse(JSON.stringify(s));
  let last = null;
  let changes = 0;
  for (let t = s.startedAt; t < s.startedAt + 24 * 3_600_000; t += 997) {
    const a = musicAt(s, t);
    assert.deepEqual(a, musicAt(other, t));
    assert.ok(a.start <= t && t < a.end);
    if (last && a.start !== last.start) {
      changes += 1;
      assert.equal(a.start, last.end);                  // no gap, no overlap on the timeline
      assert.notEqual(a.track, last.track);             // never twice in a row
    }
    last = a;
  }
  assert.ok(changes > 650, `${changes} track changes in a day`);   // about 124 s each
});
