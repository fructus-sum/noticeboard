// Tests for the Server's time as a screen tells it (client/display/src/serverClock.js): offsets from
// timestamp exchanges, the shortest round trip winning, odd answers ignored, and two screens with
// clocks minutes apart agreeing on the Server's time. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServerClock, SAMPLES_KEPT } from '../src/serverClock.js';

// A screen whose clock is `skew` ms from the Server's, talking to it over a link with these delays
function screen(skew) {
  let t = 1_000_000;                          // the Server's "true" time
  const clock = createServerClock({ now: () => t + skew });
  const exchange = (up, down) => {
    const payload = clock.ping();
    t += up;
    const server = t;                          // the Server answers with its own time
    t += down;
    clock.pong({ sent: payload.sent, server });
  };
  return { clock, exchange, advance: (ms) => { t += ms; }, trueNow: () => t };
}

test('before any answer: its own clock', () => {
  const s = screen(90_000);
  assert.equal(s.clock.serverNow(), s.trueNow() + 90_000);
  assert.equal(s.clock.state().synced, false);
});

test('a symmetric exchange gives the offset exactly', () => {
  const s = screen(-4 * 60_000);
  s.exchange(20, 20);
  assert.equal(s.clock.serverNow(), s.trueNow());
  assert.deepEqual({ synced: s.clock.state().synced, offset: s.clock.state().offset, roundTrip: s.clock.state().roundTrip }, { synced: true, offset: 4 * 60_000, roundTrip: 40 });
});

test('the shortest round trip wins; a slow, lopsided one doesn\'t spoil it', () => {
  const s = screen(12_345);
  s.exchange(5, 5);        // good
  s.exchange(900, 50);     // slow and lopsided: its estimate is off by 425 ms
  assert.equal(s.clock.serverNow(), s.trueNow());
  assert.equal(s.clock.state().roundTrip, 10);
});

test('only the recent exchanges count', () => {
  const s = screen(0);
  s.exchange(1, 1);
  for (let i = 0; i < SAMPLES_KEPT; i++) s.exchange(30, 30);
  assert.equal(s.clock.state().roundTrip, 60, 'the old fast one has aged out');
  assert.equal(s.clock.state().samples, SAMPLES_KEPT);
});

test('odd answers are ignored', () => {
  const s = screen(0);
  s.clock.pong({ sent: 'x', server: 1 });
  s.clock.pong({ sent: s.trueNow() + 5_000, server: 1 });   // from the future: a negative round trip
  s.clock.pong(null);
  assert.equal(s.clock.state().synced, false);
});

test('two screens with clocks minutes apart agree on the Server\'s time', () => {
  const a = screen(-7 * 60_000);
  const b = screen(3 * 60_000 + 417);
  a.exchange(12, 18);
  b.exchange(40, 35);
  a.advance(1_000);
  b.advance(1_000);
  // Each is within half its round trip of the truth, so they're within a few tens of ms of each other
  assert.ok(Math.abs(a.clock.serverNow() - a.trueNow()) <= 15);
  assert.ok(Math.abs(b.clock.serverNow() - b.trueNow()) <= 38);
});
