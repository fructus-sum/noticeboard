// server/services/settingsService.js — the admin panel's view of the settings, and saving them
//
// Responsibilities
//   What GET /api/settings shows (config.json without its secrets) and what PUT /api/settings may
//   change. Only port, macFiltering and display can be changed here; the display settings are
//   merged, so saving one of them never drops the others, and each is checked (the duration's
//   range, the background colour's form, the video format). port and macFiltering are saved as
//   sent (§16 #4).
//
// Provides
//   publicSettings()  → config.json without passwordHash, jwtSecret and _comment
//   applyPatch(body)  → Promise<{ settings, keys } | { status: 400, error }>
//                       saves the allowed keys in one config write (configService emits 'change':
//                       the scheduler and the displays hear about it)
//   videoFormat()     → 'h265' | 'h264': what new videos are converted to (display.videoFormat,
//                       else the contract's default, H.265)
//
// Used by
//   routes/api/settings/general.js, services/uploadQueue (videoFormat)
//
// Uses
//   configService, slideshowRules (the duration rule), shared/contract.json (the colour's form, the
//   video formats)
const configService = require('./configService');
const { parseSlideSeconds } = require('./slideshowRules');
const { display: DISPLAY } = require('../../shared/contract.json');

const COLOUR = new RegExp(DISPLAY.colourPattern);

const HIDDEN = new Set(['passwordHash', 'jwtSecret', '_comment']);
const CHANGEABLE = ['port', 'macFiltering', 'display'];

function publicSettings() {
  const out = {};
  for (const [k, v] of Object.entries(configService.get())) {
    if (!HIDDEN.has(k)) out[k] = v;
  }
  return out;
}

// Checks and merges a change to the display settings, so saving one of them never drops the
// others (e.g. saving the slide duration keeps the location pin and logo settings)
function mergeDisplay(current, change) {
  if (!change || typeof change !== 'object') return { error: 'display must be an object' };
  const merged = { ...current };
  if (change.defaultSlideDurationSeconds !== undefined) {
    const seconds = parseSlideSeconds(change.defaultSlideDurationSeconds);
    if (seconds.error) return { error: seconds.error };
    merged.defaultSlideDurationSeconds = seconds.value;
  }
  if (change.showDeviceInfo !== undefined) merged.showDeviceInfo = change.showDeviceInfo === true;
  if (change.backgroundColor !== undefined) {
    if (typeof change.backgroundColor !== 'string' || !COLOUR.test(change.backgroundColor)) {
      return { error: 'backgroundColor must be a colour code: # and six hex digits, e.g. #000000' };
    }
    merged.backgroundColor = change.backgroundColor.toLowerCase();
  }
  if (change.logo !== undefined) merged.logo = { ...current.logo, enabled: change.logo?.enabled !== false };
  if (change.videoFormat !== undefined) {
    if (!DISPLAY.videoFormats.includes(change.videoFormat)) {
      return { error: `videoFormat must be one of: ${DISPLAY.videoFormats.join(', ')}` };
    }
    merged.videoFormat = change.videoFormat;
  }
  return { merged };
}

async function applyPatch(body) {
  const patch = {};
  for (const key of CHANGEABLE) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (patch.display !== undefined) {
    const { merged, error } = mergeDisplay(configService.get('display') || {}, patch.display);
    if (error) return { status: 400, error };
    patch.display = merged;
  }
  if (Object.keys(patch).length === 0) {
    return { status: 400, error: 'No valid fields to update' };
  }
  await configService.update(patch);
  return { settings: publicSettings(), keys: Object.keys(patch) };
}

// What new videos are converted to: the saved choice, else the default (H.265)
function videoFormat() {
  const saved = configService.get('display')?.videoFormat;
  return DISPLAY.videoFormats.includes(saved) ? saved : DISPLAY.defaultVideoFormat;
}

module.exports = { publicSettings, applyPatch, videoFormat };
