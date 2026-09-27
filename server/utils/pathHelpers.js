// server/utils/pathHelpers.js — every file and folder the server uses, in one place
//
// Provides
//   ROOT; data/ (config, slideshows, branding, the update files); logs/; tmp/ (uploads); the built
//   apps; the guide; sample-data/; what the installer set up (installer.json, the server kiosk
//   script, the systemd units: NOTICEBOARD_SYSTEMD_DIR for tests); mediaUrl(folder, file)
//
// Used by
//   most server modules (never a hard-coded path elsewhere)
//
// Change impact
//   Installed Pis, update.sh and the kiosk scripts rely on these names (SYSTEM_DESIGN §6,
//   §15). mediaUrl must match shared/index.js (a unit test checks).
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function dataDir() { return path.join(ROOT, 'data'); }
function slideshowsDir() { return path.join(ROOT, 'data', 'slideshows'); }
function slideshowDir(folderName) { return path.join(slideshowsDir(), folderName); }
function slidesDir(folderName) { return path.join(slideshowDir(folderName), 'slides'); }
function slideshowJsonPath(folderName) { return path.join(slideshowDir(folderName), 'slideshow.json'); }
function configPath() { return path.join(dataDir(), 'config.json'); }
function logsDir() { return path.join(ROOT, 'logs'); }
function displayDistDir() { return path.join(ROOT, 'client', 'display', 'dist'); }
function adminDistDir() { return path.join(ROOT, 'client', 'admin', 'dist'); }
function guidePath() { return path.join(ROOT, 'noticeboard-guide.html'); }
// Software updates (installers/update.sh reads and writes the same files)
function updateBranchPath() { return path.join(dataDir(), 'update-branch.env'); }
function updateStatusPath() { return path.join(dataDir(), 'update-status.json'); }
function updateCheckPath() { return path.join(dataDir(), 'update-check.json'); }
function updateNoticePath() { return path.join(dataDir(), 'update-notice.json'); }
function updateRequestPath() { return path.join(ROOT, 'tmp', 'update-request'); }
// What install.sh set up: the version of its last run, and the server Pi's kiosk script
function installerRecordPath() { return path.join(dataDir(), 'installer.json'); }
function serverKioskPath() { return path.join(ROOT, 'start-kiosk.sh'); }
function requirementsPath() { return path.join(ROOT, 'system-requirements.json'); }
// Where install.sh puts the systemd units; NOTICEBOARD_SYSTEMD_DIR points elsewhere for tests
function systemdDir() { return process.env.NOTICEBOARD_SYSTEMD_DIR || '/etc/systemd/system'; }
function tmpDir() { return path.join(ROOT, 'tmp', 'noticeboard-uploads'); }
function sampleDataDir() { return path.join(ROOT, 'sample-data'); }
// The logo shown when nothing is published and in the admin sidebar: the admin's upload,
// else the placeholder that ships with the app
function brandingDir() { return path.join(dataDir(), 'branding'); }
function logoPath() { return path.join(brandingDir(), 'logo.png'); }
function defaultLogoPath() { return path.join(sampleDataDir(), 'sample-logo.png'); }

function mediaUrl(folderName, filename) { return `/media/${folderName}/slides/${filename}`; }

module.exports = {
  ROOT,
  dataDir,
  slideshowsDir,
  slideshowDir,
  slidesDir,
  slideshowJsonPath,
  configPath,
  logsDir,
  displayDistDir,
  adminDistDir,
  guidePath,
  updateBranchPath,
  updateStatusPath,
  updateCheckPath,
  updateNoticePath,
  updateRequestPath,
  installerRecordPath,
  serverKioskPath,
  requirementsPath,
  systemdDir,
  tmpDir,
  sampleDataDir,
  brandingDir,
  logoPath,
  defaultLogoPath,
  mediaUrl,
};
