const fs = require('fs');
const { slideshowJsonPath } = require('./pathHelpers');
const logger = require('./logger');

function readSlideshowJson(folder) {
  const p = slideshowJsonPath(folder);
  if (!fs.existsSync(p)) return { slides: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    logger.warn('Failed to parse slideshow.json', { folder, err: err.message });
    return { slides: [] };
  }
}

module.exports = { readSlideshowJson };
