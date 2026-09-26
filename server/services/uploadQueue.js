const PQueue = require('p-queue').default;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeConfig } = require('../utils/configIO');
const { slideshowJsonPath, slidesDir } = require('../utils/pathHelpers');
const { processImage, processVideo, getVideoDuration, typeFromMime } = require('./mediaService');
const configService = require('./configService');
const { broadcastPlaylist } = require('../socket');
const logger = require('../utils/logger');
const { withSlideshowLock } = require('../utils/slideshowLock');

const queue = new PQueue({ concurrency: 2 });

function readSlideshowJson(folder) {
  const p = slideshowJsonPath(folder);
  if (!fs.existsSync(p)) return { slides: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { slides: [] }; }
}

async function updateSlide(folder, slideId, patch) {
  // Two slides can finish processing at once; the lock stops one save wiping out the other
  await withSlideshowLock(folder, async () => {
    const data = readSlideshowJson(folder);
    const idx = data.slides.findIndex(s => s.id === slideId);
    if (idx !== -1) {
      data.slides[idx] = { ...data.slides[idx], ...patch };
      await writeConfig(slideshowJsonPath(folder), data);
    }
  });
}

function enqueueProcessing({ folder, slideId, tmpPath, mime }) {
  const type = typeFromMime(mime);

  queue.add(async () => {
    const outDir = slidesDir(folder);
    let filename, duration = null;

    try {
      if (type === 'image') {
        filename = await processImage(tmpPath, outDir, slideId);
      } else {
        filename = await processVideo(tmpPath, outDir, slideId);
        duration = await getVideoDuration(path.join(outDir, filename));
      }

      await updateSlide(folder, slideId, { filename, duration, status: 'ready' });
      configService.emit('change');
      broadcastPlaylist();
      logger.info('Slide ready', { folder, slideId, type });
    } catch (err) {
      await updateSlide(folder, slideId, { status: 'error', error: err.message });
      logger.error('Slide processing failed', { folder, slideId, err: err.message });
    } finally {
      // Clean up the tmp file regardless of outcome
      fs.unlink(tmpPath, () => {});
    }
  });
}

function queueSize() {
  return { size: queue.size, pending: queue.pending };
}

module.exports = { enqueueProcessing, queueSize };
