// server/services/contentReset.js — deleting the admin's content in one go
//
// Responsibilities
//   Delete All: every slideshow except the sample, with its slides and files. The sample
//   slideshow (and whether it's published or hidden), every setting, the logo and the background
//   colour are kept: it isn't a factory reset.
//
// Provides
//   deleteAllContent()   → { deleted: [names] }: one config write, then the folders; the displays
//                          are sent the new playlist
//
// Used by
//   routes/api/settings/maintenance.js
//
// Uses
//   services/slideshowStore (removeMany), services/slideshowRules (isSample),
//   services/displayEvents (playlistChanged), utils/logger
//
// Change impact
//   The sample must never be deleted: installed Pis rely on it coming back only through the
//   sample sync (SYSTEM_DESIGN §7).
const store = require('./slideshowStore');
const { isSample } = require('./slideshowRules');
const displayEvents = require('./displayEvents');
const logger = require('../utils/logger');

async function deleteAllContent() {
  const own = store.list().filter((s) => !isSample(s.folder));
  const removed = await store.removeMany(own.map((s) => s.folder));
  if (removed.length) displayEvents.playlistChanged();
  logger.info('Delete All: every slideshow but the sample deleted', { count: removed.length, folders: removed.map((s) => s.folder) });
  return { deleted: removed.map((s) => s.name) };
}

module.exports = { deleteAllContent };
