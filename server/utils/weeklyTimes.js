// server/utils/weeklyTimes.js — "on these days, from this time to that time", on the Server's clock
//
// Provides
//   inWeeklyWindow({ days?, startTime?, endTime? }, date) → boolean
//     true when date's weekday is in days (0 Sunday … 6 Saturday; no days list: every day) and its
//     time of day is from startTime (default 00:00) up to, not including, endTime (default 23:59).
//     Times are 'HH:MM', local time.
//   toMinutes('HH:MM') → minutes since midnight
//   atTime(date, 'HH:MM') → a new Date: that day at that time
//
// Used by
//   services/schedulerService (timed slideshows), services/audioEvents (repeating event audio)
//
// Change impact
//   A timed slideshow and a repeating event follow the same rule: changing it changes both.
function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

function atTime(date, time) {
  const d = new Date(date);
  const [h, m] = String(time).split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function inWeeklyWindow({ days, startTime, endTime }, date) {
  if (Array.isArray(days) && !days.includes(date.getDay())) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= toMinutes(startTime || '00:00') && minutes < toMinutes(endTime || '23:59');
}

module.exports = { inWeeklyWindow, toMinutes, atTime };
