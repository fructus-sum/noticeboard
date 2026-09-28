// server/services/audioEvents.js — when event audio plays: the rules, with no state (SYSTEM_DESIGN §18.3)
//
// Responsibilities
//   An audio show's event (config.audioShows[].event) is one of:
//     { mode: 'now', since }                          started by hand (ISO time), until stopped, or
//                                                     until a scheduled event starts after it
//     { mode: 'once', from, to }                      local date-times 'YYYY-MM-DDTHH:MM'
//     { mode: 'repeat', days, startTime, endTime }    days 0–6, times 'HH:MM' (utils/weeklyTimes)
//   Scheduled events (once, repeat) never overlap (clashes() is checked when saving).
//
// Provides
//   activeEvent(shows, now)          → the folder of the event playing at now, or null
//   nextChange(shows, now)           → the next Date a scheduled event starts or ends, or null
//   clashes(folder, event, shows)    → [{ folder, name, when }]: the other shows' scheduled events
//                                      this one overlaps (none for a start-now event)
//   eventState(folder, shows, now)   → null | { state: 'playing' } | { state: 'next', at } |
//                                      { state: 'ended' }   (at: ISO)
//   describe(event)                  → the event's times in words, e.g. "Sat, Sun 10:00–16:00"
//   parseLocal('YYYY-MM-DDTHH:MM')   → a Date (local time), or null
//
// Used by
//   services/audioEventClock (the active event), services/audioShowRules (clashes),
//   routes/api/audioshows.js (eventState), server/test/audioEvents.test.js
//
// Uses
//   utils/weeklyTimes
//
// Change impact
//   Which event every screen plays, and what saving refuses. Tested over simulated weeks.
const { inWeeklyWindow, toMinutes, atTime } = require('../utils/weeklyTimes');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseLocal(text) {
  const m = LOCAL.exec(String(text ?? ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1 ? null : d;
}

const isScheduled = (event) => event?.mode === 'once' || event?.mode === 'repeat';
const dayStart = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

function isOn(event, now) {
  if (event.mode === 'once') {
    const from = parseLocal(event.from);
    const to = parseLocal(event.to);
    return !!from && !!to && from <= now && now < to;
  }
  if (event.mode === 'repeat') return inWeeklyWindow(event, now);
  return false;
}

// The start of each occurrence of a repeating event on a given day, or null
function repeatOn(event, day) {
  return event.days.includes(day.getDay()) ? { from: atTime(day, event.startTime), to: atTime(day, event.endTime) } : null;
}

// The latest start at or before now, or null
function lastStart(event, now) {
  if (event.mode === 'once') {
    const from = parseLocal(event.from);
    return from && from <= now ? from : null;
  }
  for (let i = 0; i <= 7; i++) {
    const occ = repeatOn(event, addDays(dayStart(now), -i));
    if (occ && occ.from <= now) return occ.from;
  }
  return null;
}

// The next start or end after now, or null
function nextEdge(event, now) {
  if (event.mode === 'once') {
    return [parseLocal(event.from), parseLocal(event.to)].filter((d) => d && d > now).sort((a, b) => a - b)[0] ?? null;
  }
  for (let i = 0; i <= 7; i++) {
    const occ = repeatOn(event, addDays(dayStart(now), i));
    if (!occ) continue;
    if (occ.from > now) return occ.from;
    if (occ.to > now) return occ.to;
  }
  return null;
}

function activeEvent(shows, now) {
  const scheduled = shows.filter((s) => isScheduled(s.event));
  const on = scheduled.find((s) => isOn(s.event, now));
  if (on) return on.folder;
  // Started by hand: until a scheduled event starts after it; the latest one started wins
  const started = shows
    .filter((s) => s.event?.mode === 'now' && new Date(s.event.since) <= now)
    .filter((s) => !scheduled.some((o) => { const st = lastStart(o.event, now); return st && st > new Date(s.event.since); }))
    .sort((a, b) => new Date(b.event.since) - new Date(a.event.since));
  return started[0]?.folder ?? null;
}

function nextChange(shows, now) {
  return shows.filter((s) => isScheduled(s.event)).map((s) => nextEdge(s.event, now)).filter(Boolean).sort((a, b) => a - b)[0] ?? null;
}

// Does a once event (from–to) meet any occurrence of a repeating one?
function onceMeetsRepeat(once, repeat) {
  const from = parseLocal(once.from);
  const to = parseLocal(once.to);
  for (let day = dayStart(from); day < to; day = addDays(day, 1)) {
    const occ = repeatOn(repeat, day);
    if (occ && occ.from < to && from < occ.to) return true;
  }
  return false;
}

function overlap(a, b) {
  if (a.mode === 'once' && b.mode === 'once') return parseLocal(a.from) < parseLocal(b.to) && parseLocal(b.from) < parseLocal(a.to);
  if (a.mode === 'repeat' && b.mode === 'repeat') {
    return a.days.some((d) => b.days.includes(d)) && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
  }
  return a.mode === 'once' ? onceMeetsRepeat(a, b) : onceMeetsRepeat(b, a);
}

function describe(event) {
  if (event.mode === 'now') return 'from now until stopped';
  if (event.mode === 'once') return `${event.from.replace('T', ' ')} to ${event.to.replace('T', ' ')}`;
  return `${event.days.map((d) => DAY_NAMES[d]).join(', ')} ${event.startTime}–${event.endTime}`;
}

function clashes(folder, event, shows) {
  if (!isScheduled(event)) return [];
  return shows
    .filter((s) => s.folder !== folder && isScheduled(s.event) && overlap(event, s.event))
    .map((s) => ({ folder: s.folder, name: s.name, when: describe(s.event) }));
}

function eventState(folder, shows, now) {
  const show = shows.find((s) => s.folder === folder);
  if (!show?.event) return null;
  if (activeEvent(shows, now) === folder) return { state: 'playing' };
  if (show.event.mode === 'now') return { state: 'ended' };
  let at = null;
  if (show.event.mode === 'once') {
    const from = parseLocal(show.event.from);
    at = from > now ? from : null;
  } else {
    at = nextEdge(show.event, now);
    // Between two occurrences nextEdge is the next start; during one (not playing: a clash from
    // before) it would be the end, so look from then
    if (at && isOn(show.event, now)) at = nextEdge(show.event, at);
  }
  return at ? { state: 'next', at: at.toISOString() } : { state: 'ended' };
}

module.exports = { activeEvent, nextChange, clashes, eventState, describe, parseLocal };
