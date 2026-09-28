// server/routes/api/slides.js — /api/slideshows/:folder/slides: a slideshow's slides
//
// Responsibilities
//   The slides' routes: the ones every show's items share (upload of images and videos, list,
//   rename, delete, reorder: routes/api/mediaItems.js), plus making missing video thumbnails.
//   Mounted inside the slideshows API (api/index.js), behind its admin check. An upload records the
//   file's own name (originalName); renaming sets `name`, which the admin panel shows instead
//   (SYSTEM_DESIGN §14 D38).
//
// Used by
//   routes/api/index.js; the admin panel (SlideList, SlideshowDetailView)
//
// Uses
//   routes/api/mediaItems (createItemsRouter), services/slideshowStore (the data),
//   services/uploadQueue (processing, thumbnails), services/mediaTypes, middleware/asyncRoute,
//   services/displayEvents (playlistChanged), utils/logger
//
// Change impact
//   The slide fields are read by the viewer's playlist and the admin panel (SYSTEM_DESIGN
//   §5.1, §6). Names are for the admin panel only: renaming sends no playlist.
const slideshowStore = require('../../services/slideshowStore');
const { IMAGE_MIME, VIDEO_MIME } = require('../../services/mediaTypes');
const { enqueueProcessing, enqueueThumbnail } = require('../../services/uploadQueue');
const { route } = require('../../middleware/asyncRoute');
const displayEvents = require('../../services/displayEvents');
const logger = require('../../utils/logger');
const { createItemsRouter } = require('./mediaItems');

const store = slideshowStore.store;

module.exports = createItemsRouter({
  store,
  allowed: new Set([...IMAGE_MIME, ...VIDEO_MIME]),
  words: { show: 'Slideshow', item: 'Slide', items: 'Slides', idsLabel: 'slide IDs' },
  enqueue: ({ folder, id, tmpPath, mime }) => enqueueProcessing({ folder, slideId: id, tmpPath, mime }),
  // A deleted slide leaves, and a new order starts, once the slide on screen has had its time
  changed: () => displayEvents.playlistChanged(),
  extend(router) {
    // POST /api/slideshows/:folder/slides/thumbnails
    // Creates the missing thumbnails of this slideshow's videos, from a frame the server picks
    router.post('/thumbnails', route(async (req, res) => {
      const { folder } = req.params;
      const missing = await store.modifyItems(folder, (data) => {
        const videos = data.slides.filter((s) => s.type === 'video' && s.status === 'ready' && s.filename
          && !s.thumbnailPending && !store.itemFileExists(folder, s.thumbnail));
        for (const s of videos) {
          s.thumbnailPending = true;
          delete s.thumbnail;
          delete s.thumbnailError;
        }
        return videos;
      });
      for (const s of missing) enqueueThumbnail({ folder, slideId: s.id, filename: s.filename });
      logger.info('Missing video thumbnails queued', { folder, count: missing.length });
      res.status(202).json({ queued: missing.length });
    }));
  },
});
