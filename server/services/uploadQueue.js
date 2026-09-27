const PQueue = require('p-queue').default;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeConfig } = require('../utils/configIO');
const { slideshowJsonPath, slidesDir } = require('../utils/pathHelpers');
const { processImage, processVideo, getVideoDuration, createThumbnail } = require('./mediaService');
const { typeFromMime } = require('./mediaTypes');
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
    let filename, duration = null, thumbnail = null;

    try {
      if (type === 'image') {
        filename = await processImage(tmpPath, outDir, slideId);
      } else {
        filename = await processVideo(tmpPath, outDir, slideId);
        duration = await getVideoDuration(path.join(outDir, filename));
        // Only for the admin panel: a video without one still plays
        thumbnail = await createThumbnail(path.join(outDir, filename), outDir, slideId).catch((err) => {
          logger.warn('Video thumbnail failed', { folder, slideId, err: err.message });
          return null;
        });
      }

      await updateSlide(folder, slideId, { filename, duration, status: 'ready', ...(thumbnail ? { thumbnail } : {}) });
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

// Thumbnails for videos that don't have one (uploaded before thumbnails existed, or the sample's).
// Queued with the uploads, so they never compete with processing for the Pi's CPU.
function enqueueThumbnail({ folder, slideId, filename }) {
  queue.add(async () => {
    try {
      const thumbnail = await createThumbnail(path.join(slidesDir(folder), filename), slidesDir(folder), slideId);
      await updateSlide(folder, slideId, { thumbnail, thumbnailPending: undefined, thumbnailError: undefined });
    } catch (err) {
      await updateSlide(folder, slideId, { thumbnailPending: undefined, thumbnailError: err.message });
      logger.warn('Video thumbnail failed', { folder, slideId, err: err.message });
    }
  });
}

function queueSize() {
  return { size: queue.size, pending: queue.pending };
}

module.exports = { enqueueProcessing, enqueueThumbnail, queueSize };
