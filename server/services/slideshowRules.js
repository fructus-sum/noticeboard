// server/services/slideshowRules.js — the business rules for slideshows, in one place
//
// Responsibilities
//   Rules that more than one route applies, with the exact messages the admin panel shows.
//
// Provides
//   parseSlideSeconds(value)  → { value } | { error }  a whole number of seconds from 1 to 3600
//                             (shared/contract.json), used for the default duration (Settings)
//                             and a slideshow's own one
//   applyHiddenRule(before, updated) → null | { status: 409, error }  only an unpublished slideshow
//                             can be hidden (or stay hidden). Also tidies `updated.hidden`: stored
//                             only when true
//   parseAudioShow(value)     → { value } | { error }  a slideshow's background audio: an audio
//                             show's folder, or null (none) for null or '' (SYSTEM_DESIGN §18.3)
//   parseVideoSound(slide, body) → { patch } | { error }  a video's own sound: { sound: true,
//                             withSound, lowerTo } (defaults from the contract), or { sound: false }
//                             (the keys are then removed). Only for videos
//   isSample(folder)          → boolean  the sample slideshow can be hidden but never deleted
//   SAMPLE_DELETE_ERROR       the message for trying anyway
//
// Used by
//   routes/api/slideshows.js, services/settingsService.js (the default duration),
//   services/contentReset.js (isSample: Delete All keeps the sample)
//
// Uses
//   configService (sampleSlideshow), audioShowStore (which audio shows exist), shared/contract.json
//   (limits, the audio choices)
const configService = require('./configService');
const audioShowStore = require('./audioShowStore');
const { limits, audio: AUDIO } = require('../../shared/contract.json');

const { min, max } = limits.slideSeconds;
const DURATION_ERROR = `The slide duration must be a whole number of seconds from ${min} to ${max}`;

function parseSlideSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < min || seconds > max) return { error: DURATION_ERROR };
  return { value: seconds };
}

// Hiding only tidies the list: a hidden slideshow is kept exactly as it is, and only one that
// isn't published can be hidden (or stay hidden)
function applyHiddenRule(before, updated) {
  updated.hidden = updated.hidden === true;
  if (updated.hidden && updated.enabled !== false) {
    return {
      status: 409,
      error: before.hidden ? 'Unhide this slideshow before publishing it.' : 'Only unpublished slideshows can be hidden. Disable it first.',
    };
  }
  if (!updated.hidden) delete updated.hidden;
  return null;
}

function parseAudioShow(value) {
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !audioShowStore.find(value)) return { error: 'Choose an audio show that exists' };
  return { value };
}

// A video's own sound, and what the background audio does while it plays
function parseVideoSound(slide, body) {
  if (slide.type !== 'video') return { error: 'Only a video has its own sound' };
  const { sound, withSound = slide.withSound ?? AUDIO.withSound[0], lowerTo = slide.lowerTo ?? AUDIO.lowerTo.default } = body ?? {};
  if (typeof sound !== 'boolean') return { error: 'sound must be true or false' };
  if (!sound) return { patch: { sound: false } };
  if (!AUDIO.withSound.includes(withSound)) return { error: `withSound must be one of: ${AUDIO.withSound.join(', ')}` };
  const { min, max } = AUDIO.lowerTo;
  if (!Number.isInteger(lowerTo) || lowerTo < min || lowerTo > max) return { error: `lowerTo must be a whole number from ${min} to ${max}` };
  return { patch: { sound: true, withSound, lowerTo } };
}

function isSample(folder) {
  return configService.get('sampleSlideshow')?.folder === folder;
}

const SAMPLE_DELETE_ERROR = "The sample slideshow can't be deleted. You can hide it instead.";

module.exports = { parseSlideSeconds, applyHiddenRule, parseAudioShow, parseVideoSound, isSample, SAMPLE_DELETE_ERROR };
