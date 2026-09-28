// server/services/audioShowRules.js — what an audio show's settings may be
//
// Provides
//   applyChange(before, body) → { entry } | { error }: the show with the allowed changes (name,
//     enabled, order, transition, fadeSeconds, volume) checked against shared/contract.json's audio
//     limits (the admin panel uses the same through @shared AUDIO)
//   parseEvent(body, folder, shows, now) → { event } | { error, status? }: an event (SYSTEM_DESIGN
//     §18.3): null (none), { mode: 'now' } (since: now), { mode: 'once', from, to } (local
//     'YYYY-MM-DDTHH:MM', to after from and not yet passed) or { mode: 'repeat', days, startTime,
//     endTime } (end after start, within a day); a scheduled one that overlaps another show's is
//     refused (409, naming it)
//
// Used by
//   routes/api/audioshows.js
//
// Uses
//   shared/contract.json (audio), services/audioEvents (clashes, parseLocal), utils/weeklyTimes
const { audio: AUDIO } = require('../../shared/contract.json');
const { clashes, parseLocal } = require('./audioEvents');
const { toMinutes } = require('../utils/weeklyTimes');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const wholeIn = (value, { min, max }) => Number.isInteger(value) && value >= min && value <= max;

function applyChange(before, body = {}) {
  const entry = { ...before };
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required' };
    entry.name = body.name.trim();
  }
  if (body.enabled !== undefined) entry.enabled = body.enabled === true;
  if (body.order !== undefined) {
    if (!AUDIO.orders.includes(body.order)) return { error: `order must be one of: ${AUDIO.orders.join(', ')}` };
    entry.order = body.order;
  }
  if (body.transition !== undefined) {
    if (!AUDIO.transitions.includes(body.transition)) return { error: `transition must be one of: ${AUDIO.transitions.join(', ')}` };
    entry.transition = body.transition;
  }
  if (body.fadeSeconds !== undefined) {
    if (!wholeIn(body.fadeSeconds, AUDIO.fadeSeconds)) return { error: `fadeSeconds must be a whole number from ${AUDIO.fadeSeconds.min} to ${AUDIO.fadeSeconds.max}` };
    entry.fadeSeconds = body.fadeSeconds;
  }
  if (body.volume !== undefined) {
    if (!wholeIn(body.volume, AUDIO.volume)) return { error: `volume must be a whole number from ${AUDIO.volume.min} to ${AUDIO.volume.max}` };
    entry.volume = body.volume;
  }
  return { entry };
}

function parseEvent(body, folder, shows, now = new Date()) {
  if (body === null || body?.mode === null || body?.mode === 'off') return { event: null };
  let event;
  if (body?.mode === 'now') {
    event = { mode: 'now', since: now.toISOString() };
  } else if (body?.mode === 'once') {
    const from = parseLocal(body.from);
    const to = parseLocal(body.to);
    if (!from || !to) return { error: 'from and to must be a date and time (YYYY-MM-DDTHH:MM)' };
    if (to <= from) return { error: 'The end must be after the start' };
    if (to <= now) return { error: 'That time has already passed' };
    event = { mode: 'once', from: body.from, to: body.to };
  } else if (body?.mode === 'repeat') {
    const { days, startTime, endTime } = body;
    if (!Array.isArray(days) || !days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || new Set(days).size !== days.length) {
      return { error: 'Choose at least one day' };
    }
    if (!TIME.test(startTime ?? '') || !TIME.test(endTime ?? '')) return { error: 'startTime and endTime must be times (HH:MM)' };
    if (toMinutes(endTime) <= toMinutes(startTime)) return { error: 'The end must be after the start, on the same day' };
    event = { mode: 'repeat', days: [...days].sort((a, b) => a - b), startTime, endTime };
  } else {
    return { error: 'mode must be one of: now, once, repeat (or null for none)' };
  }
  const clash = clashes(folder, event, shows)[0];
  if (clash) return { status: 409, error: `Clashes with “${clash.name}” (${clash.when})` };
  return { event };
}

module.exports = { applyChange, parseEvent };
