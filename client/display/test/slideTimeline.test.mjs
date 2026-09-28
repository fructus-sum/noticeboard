// Tests for the shared slide timeline (shared/slideTimeline.mjs): each slide's time, the slide on at
// any moment, round after round, and the boundaries where a change of playlist takes effect.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotMs, positionAt, boundaryAfter } from '../../../shared/slideTimeline.mjs';

const img = (duration) => ({ type: 'image', duration });
const vid = (length) => ({ type: 'video', duration: null, length });
const slides = [img(3), vid(5), img(2)];   // 10 s a round

test('each slide\'s time: an image its duration, a video its length, 10 s when unknown', () => {
  assert.equal(slotMs(img(3)), 3000);
  assert.equal(slotMs(vid(5)), 5000);
  assert.equal(slotMs(img(null)), 10_000);
  assert.equal(slotMs(vid(null)), 10_000);
});

test('the slide on at any moment, round after round', () => {
  const at = (s) => positionAt(slides, 1000, 1000 + s * 1000);
  assert.deepEqual(at(0), { index: 0, start: 1000, end: 4000, round: 0 });
  assert.deepEqual(at(2.999), { index: 0, start: 1000, end: 4000, round: 0 });
  assert.equal(at(3).index, 1);
  assert.equal(at(7.5).index, 1);
  assert.equal(at(8).index, 2);
  assert.deepEqual(at(10), { index: 0, start: 11_000, end: 14_000, round: 1 });
  assert.equal(at(86_400 * 30 + 4).index, 1, 'a month later, still counting from the same start');
});

test('before the start: the first slide, from the start', () => {
  assert.deepEqual(positionAt(slides, 5000, 1000), { index: 0, start: 5000, end: 8000, round: 0 });
});

test('no slides: nothing on, and a change takes effect at once', () => {
  assert.equal(positionAt([], 0, 1234), null);
  assert.equal(boundaryAfter([], 0, 1234), 1234);
});

test('a change takes effect when the slide on at that moment ends', () => {
  assert.equal(boundaryAfter(slides, 0, 500), 3000);
  assert.equal(boundaryAfter(slides, 0, 3000), 8000);
  assert.equal(boundaryAfter(slides, 0, 9_999), 10_000);
});
