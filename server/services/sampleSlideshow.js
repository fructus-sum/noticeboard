const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configService = require('./configService');
const { writeConfig } = require('../utils/configIO');
const { sampleDataDir, slidesDir, slideshowJsonPath } = require('../utils/pathHelpers');
const { uniqueSlug } = require('../utils/slugify');
const { withSlideshowLock } = require('../utils/slideshowLock');
const logger = require('../utils/logger');

const NAME = 'Sample slideshow';
const IMAGE_SECONDS = 3;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO_EXT = /\.(mp4|webm)$/i;

// The files in sample-data/sample-slideshow/, in name order (01-…, 02-…)
function sampleFiles() {
  const dir = path.join(sampleDataDir(), 'sample-slideshow');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f) || VIDEO_EXT.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

// Changes whenever a sample file is added, removed, renamed or edited
function signatureOf(files) {
  const hash = crypto.createHash('sha1');
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
      filename,
      status: 'ready',
      duration: isVideo ? null : IMAGE_SECONDS,   // videos play to the end
      addedAt: new Date().toISOString(),
    };
  });
}

// Replace every slide in the sample slideshow with the current sample files. It's a demo,
// so anything added to it is replaced too.
async function replaceSlides(folder, files) {
  await withSlideshowLock(folder, async () => {
    let old = { slides: [] };
    try { old = JSON.parse(fs.readFileSync(slideshowJsonPath(folder), 'utf8')); } catch { /* none yet */ }
    const slides = copyAsSlides(files, folder);
    await writeConfig(slideshowJsonPath(folder), { ...old, slides });
    for (const slide of old.slides || []) {
      if (slide.filename) fs.rmSync(path.join(slidesDir(folder), slide.filename), { force: true });
    }
  });
}

// Keeps an unpublished "Sample slideshow" in step with sample-data/sample-slideshow/:
// created on first start, its slides replaced whenever a software update ships different
// sample files, and never recreated once someone deletes it. Images show for 3 seconds.
async function syncSampleSlideshow() {
  const files = sampleFiles();
  if (!files.length) return;
  const signature = signatureOf(files);

  let state = configService.get('sampleSlideshow');   // { folder, signature }
  if (!state && configService.get('sampleSlideshowAdded')) {
    // Added by an earlier version that didn't record its folder: find it by name
    const found = (configService.get('slideshows') || []).find((s) => s.name === NAME);
    state = { folder: found ? found.folder : null, signature: null };
  }
  if (state && state.signature === signature) return;

  const slideshows = configService.get('slideshows') || [];
  if (!state) {
    const folder = uniqueSlug(NAME);
    await replaceSlides(folder, files);
    await configService.update({
      slideshows: [...slideshows, {
        folder,
        name: NAME,
        priority: slideshows.length + 1,
        schedule: { type: 'always' },
        enabled: false,
        addedAt: new Date().toISOString(),
      }],
      sampleSlideshow: { folder, signature },
      sampleSlideshowAdded: undefined,
    });
    logger.info('Sample slideshow added (not published)', { folder, slides: files.length });
    return;
  }

  const stillThere = state.folder && slideshows.some((s) => s.folder === state.folder);
  if (stillThere) {
    await replaceSlides(state.folder, files);
    logger.info('Sample slideshow updated with new sample files', { folder: state.folder, slides: files.length });
  }
  // Deleted samples stay deleted; remember the files so this isn't checked again
  await configService.update({
    sampleSlideshow: { folder: stillThere ? state.folder : null, signature },
    sampleSlideshowAdded: undefined,
  });
}

module.exports = { syncSampleSlideshow };
