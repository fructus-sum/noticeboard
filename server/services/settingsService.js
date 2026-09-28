// server/services/settingsService.js — the admin panel's view of the settings, and saving them
//
// Responsibilities
//   What GET /api/settings shows (config.json without its secrets) and what PUT /api/settings may
//   change. Only port, macFiltering and display can be changed here; the display settings are
//   merged, so saving one of them never drops the others, and each is checked (the duration's
//   range, the background colour's form, the video format). The port is checked (a whole number
//   from 1024 to 65535) and takes effect when the Server restarts (services/restartState).
//   macFiltering is checked and merged the same way as display (SYSTEM_DESIGN §18.5 item 9): only
//   the fields sent change (enabled, a boolean; approved, the whole list: MACs lower case with
//   colons, well formed, no duplicates, labels trimmed); the Server's own "localhost" entry always
//   stays. configService.update stays a plain top-level merge.
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
//   video formats, the port's range)
const configService = require('./configService');
const { parseSlideSeconds } = require('./slideshowRules');
const { display: DISPLAY, limits: LIMITS } = require('../../shared/contract.json');

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

// A port the Server can listen on without being root
function parsePort(value) {
  const port = Number(value);
  const { min, max } = LIMITS.port;
  if (!Number.isInteger(port) || port < min || port > max) return { error: `The port must be a whole number from ${min} to ${max}` };
  return { value: port };
}

// Checks and merges a change to MAC filtering, as mergeDisplay does for the display settings
const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const SERVER_ITSELF = { mac: 'localhost', label: 'Server itself' };
function mergeMacFiltering(current, change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return { error: 'macFiltering must be an object' };
  const merged = { enabled: current.enabled === true, approved: Array.isArray(current.approved) ? current.approved : [] };
  if (change.enabled !== undefined) {
    if (typeof change.enabled !== 'boolean') return { error: 'macFiltering.enabled must be true or false' };
    merged.enabled = change.enabled;
  }
  if (change.approved !== undefined) {
    if (!Array.isArray(change.approved)) return { error: 'macFiltering.approved must be a list' };
    const seen = new Set();
    const list = [];
    for (const entry of change.approved) {
      const mac = String(entry?.mac ?? '').trim().toLowerCase().replace(/-/g, ':');
      if (mac !== 'localhost' && !MAC.test(mac)) return { error: `"${entry?.mac ?? ''}" isn't a MAC address (six pairs of hex digits, e.g. aa:bb:cc:dd:ee:ff)` };
      if (seen.has(mac)) return { error: `${mac} is in the list twice` };
      seen.add(mac);
      const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 100) : mac;
      const addedAt = typeof entry.addedAt === 'string' && !Number.isNaN(Date.parse(entry.addedAt)) ? entry.addedAt : new Date().toISOString();
      list.push({ mac, label, addedAt });
    }
    // The Server itself is always allowed, and always listed
    if (!seen.has('localhost')) list.unshift({ ...SERVER_ITSELF, addedAt: new Date().toISOString() });
    merged.approved = list;
  }
  return { merged };
}

async function applyPatch(body) {
  const patch = {};
  for (const key of CHANGEABLE) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (patch.port !== undefined) {
    const port = parsePort(patch.port);
    if (port.error) return { status: 400, error: port.error };
    patch.port = port.value;
  }
  if (patch.macFiltering !== undefined) {
    const { merged, error } = mergeMacFiltering(configService.get('macFiltering') || {}, patch.macFiltering);
    if (error) return { status: 400, error };
    patch.macFiltering = merged;
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
