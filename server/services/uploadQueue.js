// server/services/uploadQueue.js — processing uploads and making thumbnails, two at a time
//
// Provides
//   enqueueProcessing({ folder, slideId, tmpPath, mime })
//       converts the upload, marks the slide ready (or failed) and announces a new playlist
//   enqueueThumbnail({ folder, slideId, filename })   a video's still, for the admin panel, and its
//       length if it has none yet (the sample's videos): the screens need it (SYSTEM_DESIGN §3.5)
//   queueSize()
//
// Used by
//   routes/api/slides.js, services/sampleSlideshow
//
// Uses
//   services/mediaService, services/slideshowStore (modifySlides: locked), services/displayEvents,
//   services/mediaTypes, services/settingsService (videoFormat: H.265 or H.264), utils/pathHelpers,
//   utils/logger
//
// Change impact
//   Uploads wait in tmp/noticeboard-uploads until processed: update.sh waits while it has a recent
//   file, so the path must not change (SYSTEM_DESIGN §15).
const PQueue = require('p-queue').default;
const fs = require('fs');
const path = require('path');
const { slidesDir } = require('../utils/pathHelpers');
const { processImage, processVideo, getVideoDuration, createThumbnail } = require('./mediaService');
const { videoFormat } = require('./settingsService');
const { typeFromMime } = require('./mediaTypes');
const store = require('./slideshowStore');
const displayEvents = require('./displayEvents');
const logger = require('../utils/logger');

const queue = new PQueue({ concurrency: 2 });

// Two slides can finish processing at once; the store's lock stops one save wiping out the other.
// A slide deleted meanwhile stays deleted.
function updateSlide(folder, slideId, patch) {
  return store.modifySlides(folder, (data) => {
    const idx = data.slides.findIndex((s) => s.id === slideId);
    if (idx !== -1) data.slides[idx] = { ...data.slides[idx], ...patch };
  });
}

function enqueueProcessing({ folder, slideId, tmpPath, mime }) {
  const type = typeFromMime(mime);

  queue.add(async () => {
    const outDir = slidesDir(folder);
    let filename, duration = null, thumbnail = null, format = null;

    try {
      if (type === 'image') {
        filename = await processImage(tmpPath, outDir, slideId);
      } else {
        format = videoFormat();
        filename = await processVideo(tmpPath, outDir, slideId, format);
        duration = await getVideoDuration(path.join(outDir, filename));
        // Only for the admin panel: a video without one still plays
        thumbnail = await createThumbnail(path.join(outDir, filename), outDir, slideId).catch((err) => {
          logger.warn('Video thumbnail failed', { folder, slideId, err: err.message });
          return null;
        });
      }

      await updateSlide(folder, slideId, { filename, duration, status: 'ready', ...(format ? { format } : {}), ...(thumbnail ? { thumbnail } : {}) });
      displayEvents.playlistChanged();
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
      const file = path.join(slidesDir(folder), filename);
      const thumbnail = await createThumbnail(file, slidesDir(folder), slideId);
      await updateSlide(folder, slideId, { thumbnail, thumbnailPending: undefined, thumbnailError: undefined });
      // A video without its length yet (the sample's): the screens use it to keep to time
      const slide = store.readSlides(folder).slides.find((s) => s.id === slideId);
      if (slide && slide.duration == null) {
        const duration = await getVideoDuration(file);
        if (duration) {
          await updateSlide(folder, slideId, { duration });
          displayEvents.playlistChanged();
        }
      }
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
