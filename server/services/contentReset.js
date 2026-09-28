// server/services/contentReset.js — deleting the admin's content in one go, and Restore Defaults
//
// Responsibilities
//   Delete All: every slideshow except the sample, with its slides and files. The sample
//   slideshow (and whether it's published or hidden), every setting, the logo and the background
//   colour are kept: it isn't a factory reset.
//   Restore Defaults (SYSTEM_DESIGN §14 D42): as if newly installed on the branch the Pi follows.
//   The request leaves a marker (data/restore-defaults) and asks update.sh to reinstall that
//   branch into a clean folder and restart the server; the data is reset at the next start-up,
//   before anything reads it, so nothing is half-written.
//
// Provides
//   deleteAllContent()     → { deleted: [names] }: one config write, then the folders; the displays
//                            are sent the new playlist
//   requestRestore(by)     → the updates info: the marker, the status "requested" and the request
//                            (409 when the updater isn't set up or an update is running)
//   applyPendingRestore()  → whether a restore was applied. At start-up, before config.json is
//                            read: the marker is deleted first (a failing reset can't repeat), then
//                            everything in data/ but KEPT_DATA, the files in tmp/ but the updater's
//                            lock, and the logs (app.log emptied in place: the logger has it open)
//   KEPT_DATA              the files in data/ a restore keeps: the branch followed, and how the
//                            installer set this Pi up
//
// Used by
//   routes/api/settings/maintenance.js; server/index.js (applyPendingRestore)
//
// Uses
//   services/slideshowStore (removeMany), services/slideshowRules (isSample),
//   services/displayEvents (playlistChanged), services/updates (updaterReady, and its files),
//   utils/pathHelpers, utils/logger
//
// Change impact
//   The sample must never be deleted by Delete All: installed Pis rely on it coming back only
//   through the sample sync (SYSTEM_DESIGN §7). What Restore Defaults keeps is a promise to the
//   owner: the branch, the installer's record, and what installers/update.sh keeps (its
//   RESTORE_KEEP list).
const fs = require('fs');
const path = require('path');
const store = require('./slideshowStore');
const { isSample } = require('./slideshowRules');
const displayEvents = require('./displayEvents');
const logger = require('../utils/logger');
const updates = require('./updates');
const files = require('./updates/updateFiles');
const { dataDir, logsDir, tmpRootDir, restoreMarkerPath } = require('../utils/pathHelpers');

const KEPT_DATA = ['update-branch.env', 'installer.json'];
const KEPT_TMP = ['update.lock'];   // update.sh holds it while it restarts this server

async function deleteAllContent() {
  const own = store.list().filter((s) => !isSample(s.folder));
  const removed = await store.removeMany(own.map((s) => s.folder));
  if (removed.length) displayEvents.playlistChanged();
  logger.info('Delete All: every slideshow but the sample deleted', { count: removed.length, folders: removed.map((s) => s.folder) });
  return { deleted: removed.map((s) => s.name) };
}

async function requestRestore(by) {
  const info = await updates.updaterReady();
  if (info.busy) throw Object.assign(new Error('An update is in progress. Wait for it to finish, then try again.'), { status: 409, expose: true });
  const time = new Date().toISOString();
  fs.writeFileSync(restoreMarkerPath(), `${time} ${by}\n`);
  await files.saveRestoreRequest({
    state: 'requested',
    branch: info.configuredBranch,
    previousBranch: info.branch,
    commit: info.commit,
    previousCommit: info.commit,
    target: '',
    message: `Restore Defaults requested: reinstalling ${info.configuredBranch} into a clean folder. ${info.instant ? 'It starts within a few seconds.' : 'It starts at the next update check, within 15 minutes.'}`,
    time,
  });
  logger.warn('Restore Defaults requested', { by, branch: info.configuredBranch });
  return updates.getInfo();
}

// Every entry of <dir> except the names kept
function emptyDir(dir, keep = []) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!keep.includes(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function applyPendingRestore() {
  if (!fs.existsSync(restoreMarkerPath())) return false;
  fs.rmSync(restoreMarkerPath(), { force: true });
  emptyDir(dataDir(), KEPT_DATA);
  emptyDir(tmpRootDir(), KEPT_TMP);
  for (const name of fs.existsSync(logsDir()) ? fs.readdirSync(logsDir()) : []) {
    const file = path.join(logsDir(), name);
    if (name === 'app.log') fs.truncateSync(file, 0);
    else fs.rmSync(file, { recursive: true, force: true });
  }
  logger.warn('Restore Defaults: the data, the logs and the waiting files were reset; starting as a new install');
  return true;
}

module.exports = { deleteAllContent, requestRestore, applyPendingRestore, KEPT_DATA };
