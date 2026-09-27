// server/services/sampleSlideshow.js — the "Sample slideshow", kept in step with sample-data/
//
// Provides
//   syncSampleSlideshow()   at start-up: creates it once, and when the sample files change (a new
//                           version brought new examples) replaces its slides with them. The
//                           admin's own choices (published, hidden, schedule…) are kept.
//
// Used by
//   server/index.js (an error is logged, never stops the server)
//
// Uses
//   services/slideshowStore, services/configService (sampleSlideshow), services/uploadQueue (its
//   video's thumbnail), services/mediaTypes, services/mediaNames (each slide's name is its sample
//   file's), utils/slugify, utils/pathHelpers
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configService = require('./configService');
const store = require('./slideshowStore');
const { sampleDataDir, slidesDir } = require('../utils/pathHelpers');
const { uniqueSlug } = require('../utils/slugify');
const { enqueueThumbnail } = require('./uploadQueue');
const { nameFromUpload } = require('./mediaNames');
const logger = require('../utils/logger');

const NAME = 'Sample slideshow';
// Slideshow settings the sample demonstrates, e.g. its own slide duration. Only these are
// taken from sample.json; the admin's own choices (published, hidden, schedule...) are kept.
const MANIFEST = 'sample.json';
const MANIFEST_SETTINGS = ['slideDurationSeconds'];
const { SAMPLE_IMAGE_EXT: IMAGE_EXT, SAMPLE_VIDEO_EXT: VIDEO_EXT } = require('./mediaTypes');

// The files in sample-data/sample-slideshow/, in name order (01-…, 02-…)
function sampleFiles() {
  const dir = sampleDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f) || VIDEO_EXT.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function sampleDir() {
  return path.join(sampleDataDir(), 'sample-slideshow');
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(sampleDir(), MANIFEST), 'utf8'));
  } catch {
    return {};
  }
}

// Changes whenever a sample file is added, removed, renamed or edited, or sample.json changes
function signatureOf(files) {
  const hash = crypto.createHash('sha1');
  const manifest = path.join(sampleDir(), MANIFEST);
  if (fs.existsSync(manifest)) hash.update(fs.readFileSync(manifest));
  for (const file of files) {
    hash.update(path.basename(file));
    hash.update(crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'));
  }
  return hash.digest('hex');
}

// Copy the sample files into a slideshow's folder as slides (same shape as processed uploads)
function copyAsSlides(files, folder) {
  fs.mkdirSync(slidesDir(folder), { recursive: true });
  return files.map((file) => {
    const id = crypto.randomUUID();
    const filename = `${id}${path.extname(file).toLowerCase()}`;
    fs.copyFileSync(file, path.join(slidesDir(folder), filename));
    const isVideo = VIDEO_EXT.test(file);
    return {
      id,
      type: isVideo ? 'video' : 'image',
      originalName: nameFromUpload(path.basename(file)),
      filename,
      status: 'ready',
      duration: null,   // the slideshow's own duration (sample.json); videos play to the end
      ...(isVideo ? { thumbnailPending: true } : {}),
      addedAt: new Date().toISOString(),
    };
  });
}

// Replace every slide in the sample slideshow with the current sample files. It's a demo,
// so anything added to it is replaced too. The new list is saved before the old files are
// deleted, so slideshow.json never points at files that are gone.
async function replaceSlides(folder, files) {
  const { previous, slides } = await store.modifySlides(folder, (data) => {
    const before = data.slides;
    data.slides = copyAsSlides(files, folder);
    return { previous: before, slides: data.slides };
  });
  for (const slide of previous) store.removeSlideFiles(folder, slide);
  // Thumbnails for the sample's videos, made in the background like an upload's
  for (const slide of slides.filter((s) => s.type === 'video')) {
    enqueueThumbnail({ folder, slideId: slide.id, filename: slide.filename });
  }
}

// The sample.json settings, applied to the sample's entry in config.json
function withManifest(entry) {
  const manifest = readManifest();
  const updated = { ...entry };
  for (const key of MANIFEST_SETTINGS) {
    if (manifest[key] !== undefined) updated[key] = manifest[key];
  }
  return updated;
}

// Keeps the "Sample slideshow" in step with sample-data/sample-slideshow/, so each software
// update can show off new features in it: created (unpublished) on first start, and whenever
// an update ships different sample files or settings, its slides are replaced with the new
// ones (new images and videos included) and sample.json's settings applied. It can be hidden
// but not deleted; one deleted by an older version comes back, hidden.
async function syncSampleSlideshow() {
  const files = sampleFiles();
  if (!files.length) return;
  const signature = signatureOf(files);

  let state = configService.get('sampleSlideshow');   // { folder, signature }
  if (!state && configService.get('sampleSlideshowAdded')) {
    // Added by an earlier version that didn't record its folder: find it by name
    const found = store.list().find((s) => s.name === NAME);
    state = { folder: found ? found.folder : null, signature: null };
  }
  const slideshows = store.list();
  const stillThere = !!state?.folder && slideshows.some((s) => s.folder === state.folder);
  if (stillThere && state.signature === signature) return;

  if (!stillThere) {
    // First start, or deleted by an older version: add it. Hidden if it was here before.
    const folder = uniqueSlug(NAME);
    const returning = !!state;
    await replaceSlides(folder, files);
    await store.commitEntries([...slideshows, withManifest({
      folder,
      name: NAME,
      priority: slideshows.length + 1,
      schedule: { type: 'always' },
      enabled: false,
      ...(returning ? { hidden: true } : {}),
      addedAt: new Date().toISOString(),
    })], { sampleSlideshow: { folder, signature }, sampleSlideshowAdded: undefined });
    logger.info(returning ? 'Sample slideshow restored (hidden)' : 'Sample slideshow added (not published)', { folder, slides: files.length });
    return;
  }

  await replaceSlides(state.folder, files);
  await store.commitEntries(
    slideshows.map((s) => (s.folder === state.folder ? withManifest(s) : s)),
    { sampleSlideshow: { folder: state.folder, signature }, sampleSlideshowAdded: undefined },
  );
  logger.info('Sample slideshow updated with the new sample files', { folder: state.folder, slides: files.length });
}

module.exports = { syncSampleSlideshow };
