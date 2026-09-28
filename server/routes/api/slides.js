// server/routes/api/slides.js — /api/slideshows/:folder/slides: a slideshow's slides
//
// Responsibilities
//   The slides' routes: the ones every show's items share (upload of images and videos, list,
//   rename, delete, reorder: routes/api/mediaItems.js), plus making missing video thumbnails and a
//   video's own sound (SYSTEM_DESIGN §18.3).
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
//   services/displayEvents (playlistChanged), services/slideshowRules (parseVideoSound), utils/logger
//
// Change impact
//   The slide fields are read by the viewer's playlist and the admin panel (SYSTEM_DESIGN
//   §5.1, §6). Names are for the admin panel only: renaming sends no playlist.
const slideshowStore = require('../../services/slideshowStore');
const { IMAGE_MIME, VIDEO_MIME } = require('../../services/mediaTypes');
const { enqueueProcessing, enqueueThumbnail } = require('../../services/uploadQueue');
const { route } = require('../../middleware/asyncRoute');
const displayEvents = require('../../services/displayEvents');
const rules = require('../../services/slideshowRules');
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

    // PUT /api/slideshows/:folder/slides/:id/sound
    // Body: { sound, withSound?, lowerTo? }. A video plays its own sound; the background audio is
    // lowered to lowerTo % or paused meanwhile. Off removes the three keys, so the slide is as before.
    router.put('/:id/sound', route(async (req, res) => {
      const { folder, id } = req.params;
      let error = null;
      const slide = await store.modifyItems(folder, (data) => {
        const found = data.slides.find((s) => s.id === id);
        if (!found) return null;
        const parsed = rules.parseVideoSound(found, req.body);
        if (parsed.error) { error = parsed.error; return found; }
        delete found.sound; delete found.withSound; delete found.lowerTo;
        if (parsed.patch.sound) Object.assign(found, parsed.patch);
        return found;
      });
      if (!slide) return res.status(404).json({ error: 'Slide not found' });
      if (error) return res.status(400).json({ error });
      displayEvents.playlistChanged();
      logger.info('Slide sound set', { folder, id, sound: slide.sound === true });
      res.json(slide);
    }));
  },
});
