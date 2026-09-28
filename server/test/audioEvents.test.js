// Tests for event audio's rules (services/audioEvents.js) and the weekly rule they share with timed
// slideshows (utils/weeklyTimes.js), on local times (2026-10-03 is a Saturday). Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activeEvent, nextChange, clashes, eventState, describe, parseLocal } = require('../services/audioEvents');
const { inWeeklyWindow } = require('../utils/weeklyTimes');

const at = (text) => parseLocal(text);
const show = (folder, event) => ({ folder, name: folder, event });
const fair = show('fair', { mode: 'once', from: '2026-10-03T10:00', to: '2026-10-03T16:00' });
const lunch = show('lunch', { mode: 'repeat', days: [1, 2, 3, 4, 5], startTime: '12:00', endTime: '13:00' });
const weekend = show('weekend', { mode: 'repeat', days: [0, 6], startTime: '09:00', endTime: '10:00' });

test('the weekly rule: days, from the start time up to (not including) the end', () => {
  const t = { days: [6], startTime: '10:00', endTime: '16:00' };
  assert.equal(inWeeklyWindow(t, at('2026-10-03T09:59')), false);
  assert.equal(inWeeklyWindow(t, at('2026-10-03T10:00')), true);
  assert.equal(inWeeklyWindow(t, at('2026-10-03T15:59')), true);
  assert.equal(inWeeklyWindow(t, at('2026-10-03T16:00')), false);
  assert.equal(inWeeklyWindow(t, at('2026-10-04T12:00')), false, 'Sunday is not in the days');
  assert.equal(inWeeklyWindow({ startTime: '10:00', endTime: '16:00' }, at('2026-10-04T12:00')), true, 'no days: every day');
});

test('once: plays from its start up to its end', () => {
  const shows = [fair];
  assert.equal(activeEvent(shows, at('2026-10-03T09:59')), null);
  assert.equal(activeEvent(shows, at('2026-10-03T10:00')), 'fair');
  assert.equal(activeEvent(shows, at('2026-10-03T15:59')), 'fair');
  assert.equal(activeEvent(shows, at('2026-10-03T16:00')), null);
});

test('repeat: on its days and times, every week', () => {
  const shows = [lunch];
  assert.equal(activeEvent(shows, at('2026-10-05T12:30')), 'lunch', 'Monday');
  assert.equal(activeEvent(shows, at('2026-10-12T12:30')), 'lunch', 'a week later');
  assert.equal(activeEvent(shows, at('2026-10-04T12:30')), null, 'Sunday');
  assert.equal(activeEvent(shows, at('2026-10-05T13:00')), null, 'the end');
});

test('start now: until stopped, or until a scheduled event starts after it (which then plays)', () => {
  const now = show('now', { mode: 'now', since: at('2026-10-03T08:00').toISOString() });
  const shows = [now, fair];
  assert.equal(activeEvent(shows, at('2026-10-03T07:59')), null, 'not before it was started');
  assert.equal(activeEvent(shows, at('2026-10-03T09:00')), 'now');
  assert.equal(activeEvent(shows, at('2026-10-03T11:00')), 'fair', 'the scheduled event takes over');
  assert.equal(activeEvent(shows, at('2026-10-03T17:00')), null, 'and the start-now event has ended');
  assert.deepEqual(eventState('now', shows, at('2026-10-03T17:00')), { state: 'ended' });
  // Started during a scheduled event's gap, a later start of that repeat ends it
  const later = show('later', { mode: 'now', since: at('2026-10-05T13:30').toISOString() });
  assert.equal(activeEvent([later, lunch], at('2026-10-05T20:00')), 'later');
  assert.equal(activeEvent([later, lunch], at('2026-10-06T12:30')), 'lunch');
  assert.equal(activeEvent([later, lunch], at('2026-10-06T14:00')), null);
  // Two started by hand: the latest wins
  const a = show('a', { mode: 'now', since: at('2026-10-03T08:00').toISOString() });
  const b = show('b', { mode: 'now', since: at('2026-10-03T08:30').toISOString() });
  assert.equal(activeEvent([a, b], at('2026-10-03T09:00')), 'b');
});

test('nextChange: the next start or end of any scheduled event', () => {
  const shows = [fair, lunch];
  assert.deepEqual(nextChange(shows, at('2026-10-03T08:00')), at('2026-10-03T10:00'));
  assert.deepEqual(nextChange(shows, at('2026-10-03T11:00')), at('2026-10-03T16:00'));
  assert.deepEqual(nextChange(shows, at('2026-10-03T17:00')), at('2026-10-05T12:00'), 'the next weekday lunch');
  assert.deepEqual(nextChange(shows, at('2026-10-05T12:10')), at('2026-10-05T13:00'));
  assert.equal(nextChange([show('x', null)], at('2026-10-03T08:00')), null);
});

test('clashes: every pair of scheduled modes; a start-now event never clashes', () => {
  const others = [fair, lunch, weekend];
  // once with once
  assert.deepEqual(clashes('new', { mode: 'once', from: '2026-10-03T15:00', to: '2026-10-03T18:00' }, others).map((c) => c.folder), ['fair']);
  assert.deepEqual(clashes('new', { mode: 'once', from: '2026-10-03T16:00', to: '2026-10-03T18:00' }, others), [], 'touching ends don\'t clash');
  // once with repeat: Monday 12:30–14:00 meets lunch; Saturday 09:30 meets the weekend repeat and not the fair
  assert.deepEqual(clashes('new', { mode: 'once', from: '2026-10-05T12:30', to: '2026-10-05T14:00' }, others).map((c) => c.folder), ['lunch']);
  assert.deepEqual(clashes('new', { mode: 'once', from: '2026-10-03T09:30', to: '2026-10-03T09:45' }, others).map((c) => c.folder), ['weekend']);
  // repeat with once and with repeat
  assert.deepEqual(clashes('new', { mode: 'repeat', days: [6], startTime: '15:00', endTime: '17:00' }, others).map((c) => c.folder), ['fair']);
  assert.deepEqual(clashes('new', { mode: 'repeat', days: [3], startTime: '12:59', endTime: '14:00' }, others).map((c) => c.folder), ['lunch']);
  assert.deepEqual(clashes('new', { mode: 'repeat', days: [3], startTime: '13:00', endTime: '14:00' }, others), []);
  // itself, and start now
  assert.deepEqual(clashes('fair', fair.event, others), []);
  assert.deepEqual(clashes('new', { mode: 'now', since: new Date().toISOString() }, others), []);
  assert.equal(clashes('new', { mode: 'repeat', days: [0], startTime: '09:30', endTime: '11:00' }, others)[0].when, 'Sun, Sat 09:00–10:00');
});

test('eventState: playing, next (when), or ended', () => {
  const shows = [fair, lunch];
  assert.deepEqual(eventState('fair', shows, at('2026-10-03T08:00')), { state: 'next', at: at('2026-10-03T10:00').toISOString() });
  assert.deepEqual(eventState('fair', shows, at('2026-10-03T12:00')), { state: 'playing' });
  assert.deepEqual(eventState('fair', shows, at('2026-10-03T16:00')), { state: 'ended' });
  assert.deepEqual(eventState('lunch', shows, at('2026-10-03T12:00')), { state: 'next', at: at('2026-10-05T12:00').toISOString() });
  assert.equal(eventState('none', [show('none', undefined)], at('2026-10-03T12:00')), null);
  assert.equal(describe(fair.event), '2026-10-03 10:00 to 2026-10-03 16:00');
});

test('a simulated fortnight minute by minute: nextChange always lands where activeEvent changes', () => {
  const shows = [fair, lunch, weekend];
  let t = at('2026-10-01T00:00');
  const end = at('2026-10-15T00:00');
  let current = activeEvent(shows, t);
  let predicted = nextChange(shows, t);
  for (; t < end; t = new Date(t.getTime() + 60_000)) {
    const now = activeEvent(shows, t);
    if (now !== current) {
      assert.deepEqual(t, predicted, `changed to ${now} at ${t.toString()}`);
      current = now;
    }
    if (predicted && t >= predicted) predicted = nextChange(shows, t);
  }
});
