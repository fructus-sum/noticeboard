// server/services/audioShowRules.js — what an audio show's settings may be
//
// Provides
//   applyChange(before, body) → { entry } | { error }: the show with the allowed changes (name,
//     enabled, order, transition, fadeSeconds, volume) checked against shared/contract.json's audio
//     limits (the admin panel uses the same through @shared AUDIO)
//
// Used by
//   routes/api/audioshows.js
//
// Uses
//   shared/contract.json (audio)
const { audio: AUDIO } = require('../../shared/contract.json');

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

module.exports = { applyChange };
