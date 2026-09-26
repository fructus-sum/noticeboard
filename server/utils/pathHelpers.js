const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function dataDir() { return path.join(ROOT, 'data'); }
function slideshowsDir() { return path.join(ROOT, 'data', 'slideshows'); }
function slideshowDir(folderName) { return path.join(slideshowsDir(), folderName); }
function slidesDir(folderName) { return path.join(slideshowDir(folderName), 'slides'); }
function slideshowJsonPath(folderName) { return path.join(slideshowDir(folderName), 'slideshow.json'); }
function configPath() { return path.join(dataDir(), 'config.json'); }
function logsDir() { return path.join(ROOT, 'logs'); }
function tmpDir() { return path.join(ROOT, 'tmp', 'noticeboard-uploads'); }
function sampleDataDir() { return path.join(ROOT, 'sample-data'); }

function watermarkDir(folderName) { return path.join(slideshowDir(folderName), 'watermark'); }
function watermarkPath(folderName, filename) { return path.join(watermarkDir(folderName), filename); }

function mediaUrl(folderName, filename) { return `/media/${folderName}/slides/${filename}`; }
function watermarkUrl(folderName, filename) { return `/media/${folderName}/watermark/${filename}`; }

module.exports = {
  ROOT,
  dataDir,
  slideshowsDir,
  slideshowDir,
  slidesDir,
  slideshowJsonPath,
  watermarkDir,
  watermarkPath,
  configPath,
  logsDir,
  tmpDir,
  sampleDataDir,
  mediaUrl,
  watermarkUrl,
};
