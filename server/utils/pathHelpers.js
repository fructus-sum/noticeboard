const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function dataDir() { return path.join(ROOT, 'data'); }
function slideshowsDir() { return path.join(ROOT, 'data', 'slideshows'); }
function slideshowDir(folderName) { return path.join(slideshowsDir(), folderName); }
function slidesDir(folderName) { return path.join(slideshowDir(folderName), 'slides'); }
function audioPath(folderName) { return path.join(slideshowDir(folderName), 'audio.mp3'); }
function slideshowJsonPath(folderName) { return path.join(slideshowDir(folderName), 'slideshow.json'); }
function configPath() { return path.join(dataDir(), 'config.json'); }
function logsDir() { return path.join(ROOT, 'logs'); }
function displayDistDir() { return path.join(ROOT, 'client', 'display', 'dist'); }
function guidePath() { return path.join(ROOT, 'noticeboard-guide.html'); }
// Software updates (installers/update.sh reads and writes the same files)
function updateBranchPath() { return path.join(dataDir(), 'update-branch.env'); }
function updateStatusPath() { return path.join(dataDir(), 'update-status.json'); }
function updateCheckPath() { return path.join(dataDir(), 'update-check.json'); }
function updateNoticePath() { return path.join(dataDir(), 'update-notice.json'); }
function updateRequestPath() { return path.join(ROOT, 'tmp', 'update-request'); }
// Where install.sh puts the systemd units; NOTICEBOARD_SYSTEMD_DIR points elsewhere for tests
function systemdDir() { return process.env.NOTICEBOARD_SYSTEMD_DIR || '/etc/systemd/system'; }
function tmpDir() { return path.join(ROOT, 'tmp', 'noticeboard-uploads'); }
function sampleDataDir() { return path.join(ROOT, 'sample-data'); }

function mediaUrl(folderName, filename) { return `/media/${folderName}/slides/${filename}`; }
function audioUrl(folderName) { return `/media/${folderName}/audio.mp3`; }

module.exports = {
  ROOT,
  dataDir,
  slideshowsDir,
  slideshowDir,
  slidesDir,
  audioPath,
  slideshowJsonPath,
  configPath,
  logsDir,
  displayDistDir,
  guidePath,
  updateBranchPath,
  updateStatusPath,
  updateCheckPath,
  updateNoticePath,
  updateRequestPath,
  systemdDir,
  tmpDir,
  sampleDataDir,
  mediaUrl,
  audioUrl,
};
