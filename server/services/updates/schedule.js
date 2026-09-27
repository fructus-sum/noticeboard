// server/services/updates/schedule.js — the update schedule's rules on the server side
//
// Responsibilities
//   What a valid schedule and a valid set time are, before they are saved for update.sh
//   (SYSTEM_DESIGN §14 D41). When an install is due is decided only by update.sh
//   (installers/lib/schedule.sh), which writes the next install time into update-check.json;
//   the server never works it out itself.
//
// Provides
//   EVERY                       the schedules: '15min' (the default), '2h', 'daily', 'weekly', 'manual'
//   DEFAULT                     { every: '15min', time: '00:00', day: 0 }
//   parseSchedule(body)         → { every, time, day } or { error }
//   parseInstallAt(value)       → { at: ISO string } or { error }: a date and time within a year
//
// Used by
//   services/updates/index.js, services/updates/updateFiles.js (the defaults)
const EVERY = ['15min', '2h', 'daily', 'weekly', 'manual'];
const DEFAULT = { every: '15min', time: '00:00', day: 0 };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

function parseSchedule(body) {
  const every = body?.every;
  if (!EVERY.includes(every)) return { error: `The schedule must be one of: ${EVERY.join(', ')}.` };
  const time = body.time ?? DEFAULT.time;
  if (typeof time !== 'string' || !TIME.test(time)) return { error: 'The time must be HH:MM, e.g. 00:00 or 18:30.' };
  const day = body.day ?? DEFAULT.day;
  if (!Number.isInteger(day) || day < 0 || day > 6) return { error: 'The day must be 0 (Sunday) to 6 (Saturday).' };
  return { every, time, day };
}

function parseInstallAt(value) {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(t)) return { error: 'Choose a date and time for the update.' };
  if (t > Date.now() + YEAR_MS) return { error: 'Choose a time within the next year.' };
  return { at: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

module.exports = { EVERY, DEFAULT, parseSchedule, parseInstallAt };
