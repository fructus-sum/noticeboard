const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configService = require('./configService');
const { writeConfig } = require('../utils/configIO');
const { sampleDataDir, slidesDir, slideshowJsonPath } = require('../utils/pathHelpers');
const { uniqueSlug } = require('../utils/slugify');
const logger = require('../utils/logger');

const NAME = 'Sample slideshow';
const SLIDE_SECONDS = 3;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

// Gives each system an unpublished sample slideshow, built from the images in
// sample-data/sample-slideshow/ in file-name order (01-…, 02-…). It is added once:
// the sampleSlideshowAdded flag in config.json stops it returning after it's deleted.
async function addSampleSlideshow() {
  if (configService.get('sampleSlideshowAdded')) return;

  const source = path.join(sampleDataDir(), 'sample-slideshow');
  const images = fs.existsSync(source)
    ? fs.readdirSync(source).filter((f) => IMAGE_EXT.test(f)).sort()
    : [];
  if (!images.length) return;

  const folder = uniqueSlug(NAME);
  fs.mkdirSync(slidesDir(folder), { recursive: true });

  // Same shape as an uploaded, processed slide
  const slides = images.map((image) => {
    const id = crypto.randomUUID();
    const filename = `${id}${path.extname(image).toLowerCase()}`;
    fs.copyFileSync(path.join(source, image), path.join(slidesDir(folder), filename));
    return { id, type: 'image', filename, status: 'ready', duration: SLIDE_SECONDS, addedAt: new Date().toISOString() };
  });
  await writeConfig(slideshowJsonPath(folder), { slides });

  const existing = configService.get('slideshows') || [];
  await configService.update({
    slideshows: [...existing, {
      folder,
      name: NAME,
      priority: existing.length + 1,
      schedule: { type: 'always' },
      enabled: false,
      addedAt: new Date().toISOString(),
    }],
    sampleSlideshowAdded: true,
  });
  logger.info('Sample slideshow added (not published)', { folder, slides: slides.length });
}

module.exports = { addSampleSlideshow };
