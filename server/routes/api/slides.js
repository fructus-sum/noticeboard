// server/routes/api/slides.js — /api/slideshows/:folder/slides: a slideshow's slides
//
// Responsibilities
//   Uploading (up to 50 files, 500 MB each), listing, deleting, reordering, and making missing
//   video thumbnails. Mounted inside the slideshows API (api/index.js), behind its admin check.
//
// Used by
//   routes/api/index.js; the admin panel (SlideList, SlideshowDetailView)
//
// Uses
//   services/slideshowStore (the data), services/uploadQueue (processing), services/mediaTypes,
//   middleware/uploads, middleware/asyncRoute, services/displayEvents (playlistChanged)
//
// Change impact
//   The slide fields are read by the viewer's playlist and the admin panel (CURRENT_SYSTEM_DESIGN
//   §5.1, §6).
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const store = require('../../services/slideshowStore');
const { typeFromMime, IMAGE_MIME, VIDEO_MIME } = require('../../services/mediaTypes');
const { enqueueProcessing, enqueueThumbnail, queueSize } = require('../../services/uploadQueue');
const { createUpload } = require('../../middleware/uploads');
const { route } = require('../../middleware/asyncRoute');
const displayEvents = require('../../services/displayEvents');
const logger = require('../../utils/logger');

const router = express.Router({ mergeParams: true });

const upload = createUpload({
  prefix: 'upload',
  maxFileBytes: 500 * 1024 * 1024,
  allowed: new Set([...IMAGE_MIME, ...VIDEO_MIME]),
  rejectMessage: 'Unsupported file type',
});

// Verify slideshow exists before handling any slide routes
router.use((req, res, next) => {
  if (!store.find(req.params.folder)) {
    return res.status(404).json({ error: 'Slideshow not found' });
  }
  next();
});

// GET /api/slideshows/:folder/slides
router.get('/', (req, res) => {
  res.json(store.readSlides(req.params.folder).slides);
});

// POST /api/slideshows/:folder/slides
router.post('/', upload.array('files', 50), route(async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const { folder } = req.params;
  const queued = req.files.map((file) => ({
    entry: {
      id: crypto.randomUUID(),
      type: typeFromMime(file.mimetype),
      filename: null,
      status: 'processing',
      duration: null,
      addedAt: new Date().toISOString(),
    },
    tmpPath: file.path,
    mime: file.mimetype,
  }));

  await store.modifySlides(folder, (data) => { data.slides.push(...queued.map((q) => q.entry)); });

  for (const { entry, tmpPath, mime } of queued) {
    enqueueProcessing({ folder, slideId: entry.id, tmpPath, mime });
  }

  logger.info('Slides upload accepted', { folder, count: queued.length, ...queueSize() });
  res.status(202).json(queued.map((q) => q.entry));
}));

// DELETE /api/slideshows/:folder/slides/:id
router.delete('/:id', route(async (req, res) => {
  const { folder, id } = req.params;
  const slide = await store.modifySlides(folder, (data) => {
    const idx = data.slides.findIndex((s) => s.id === id);
    return idx === -1 ? null : data.slides.splice(idx, 1)[0];
  });
  if (!slide) return res.status(404).json({ error: 'Slide not found' });

  store.removeSlideFiles(folder, slide);   // the media file and a video's thumbnail
  displayEvents.playlistChanged();   // displays drop it once the slide on screen has had its time
  logger.info('Slide deleted', { folder, id });
  res.json({ ok: true });
}));

// POST /api/slideshows/:folder/slides/thumbnails
// Creates the missing thumbnails of this slideshow's videos, from a frame the server picks
router.post('/thumbnails', route(async (req, res) => {
  const { folder } = req.params;
  const missing = await store.modifySlides(folder, (data) => {
    const videos = data.slides.filter((s) => s.type === 'video' && s.status === 'ready' && s.filename
      && !s.thumbnailPending && !store.slideFileExists(folder, s.thumbnail));
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

// PUT /api/slideshows/:folder/slides/reorder
// Body: { order: ['id1', 'id2', ...] }
router.put('/reorder', route(async (req, res) => {
  const { folder } = req.params;
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of slide IDs' });

  const reordered = await store.modifySlides(folder, (data) => {
    const byId = Object.fromEntries(data.slides.map((s) => [s.id, s]));
    // IDs in `order` come first (in given sequence), any remaining slides appended
    data.slides = [
      ...order.filter((id) => byId[id]).map((id) => byId[id]),
      ...data.slides.filter((s) => !order.includes(s.id)),
    ];
    return data.slides;
  });
  displayEvents.playlistChanged();   // the new order starts once the slide on screen has had its time
  logger.info('Slides reordered', { folder });
  res.json(reordered);
}));

// Error handler for multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
