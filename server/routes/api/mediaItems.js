// server/routes/api/mediaItems.js — the routes every show's items share (slides, audio tracks)
//
// Responsibilities
//   One router factory for a show's items: upload (up to 50 files, 500 MB each, only the given
//   types), list, rename (SYSTEM_DESIGN §14 D38), delete, reorder; a kind adds its own routes (e.g.
//   the slides' thumbnails) through `extend`. Mounted inside its show's API (/:folder/<items>),
//   behind that API's admin check. Every text an admin or a test sees comes from `words`, so each
//   kind keeps its own messages.
//
// Provides
//   createItemsRouter({ store, allowed, words, enqueue, changed, extend }) → an express router
//     store      a show store (services/showStore): find, readItems, modifyItems, removeItemFiles,
//                itemsKey
//     allowed    the MIME types an upload may have
//     words      { show: 'Slideshow', item: 'Slide', items: 'Slides', idsLabel: 'slide IDs' }: the
//                messages and log lines
//     enqueue({ folder, id, tmpPath, mime })  processes an upload (services/uploadQueue)
//     changed()  after an item is deleted or the items reordered (e.g. send the playlist)
//     extend(router)  adds the kind's own routes, before the error handler
//
// Used by
//   routes/api/slides.js
//
// Uses
//   services/mediaTypes (typeFromMime), services/mediaNames (the name rule),
//   services/uploadQueue (queueSize), middleware/uploads, middleware/asyncRoute, utils/logger
//
// Change impact
//   The answers and messages are recorded in tests/fixtures/api-contract.json: a kind's words must
//   stay the same, or the admin panel and the contract change.
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { typeFromMime } = require('../../services/mediaTypes');
const mediaNames = require('../../services/mediaNames');
const { queueSize } = require('../../services/uploadQueue');
const { createUpload } = require('../../middleware/uploads');
const { route } = require('../../middleware/asyncRoute');
const logger = require('../../utils/logger');

function createItemsRouter({ store, allowed, words, enqueue, changed = () => {}, extend = () => {} }) {
  const router = express.Router({ mergeParams: true });
  const key = store.itemsKey;

  const upload = createUpload({
    prefix: 'upload',
    maxFileBytes: 500 * 1024 * 1024,
    allowed,
    rejectMessage: 'Unsupported file type',
  });

  // The show must exist before any of its items' routes
  router.use((req, res, next) => {
    if (!store.find(req.params.folder)) {
      return res.status(404).json({ error: `${words.show} not found` });
    }
    next();
  });

  // GET /…/:folder/<items>
  router.get('/', (req, res) => {
    res.json(store.readItems(req.params.folder)[key]);
  });

  // POST /…/:folder/<items>
  router.post('/', upload.array('files', 50), route(async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const { folder } = req.params;
    const queued = req.files.map((file) => ({
      entry: {
        id: crypto.randomUUID(),
        type: typeFromMime(file.mimetype),
        originalName: mediaNames.nameFromUpload(file.originalname),
        filename: null,
        status: 'processing',
        duration: null,
        addedAt: new Date().toISOString(),
      },
      tmpPath: file.path,
      mime: file.mimetype,
    }));

    await store.modifyItems(folder, (data) => { data[key].push(...queued.map((q) => q.entry)); });

    for (const { entry, tmpPath, mime } of queued) {
      enqueue({ folder, id: entry.id, tmpPath, mime });
    }

    logger.info(`${words.items} upload accepted`, { folder, count: queued.length, ...queueSize() });
    res.status(202).json(queued.map((q) => q.entry));
  }));

  // PATCH /…/:folder/<items>/:id
  // Body: { name }. An empty name removes the item's own name, so it goes back to the uploaded
  // file's name. The stored file keeps its name.
  router.patch('/:id', route(async (req, res) => {
    const { folder, id } = req.params;
    const { name } = req.body ?? {};
    if (name !== null && typeof name !== 'string') return res.status(400).json({ error: 'name must be text' });
    const cleaned = mediaNames.cleanName(name);
    if ([...cleaned].length > mediaNames.MAX_LENGTH) {
      return res.status(400).json({ error: `A name can be at most ${mediaNames.MAX_LENGTH} characters` });
    }

    const item = await store.modifyItems(folder, (data) => {
      const found = data[key].find((s) => s.id === id);
      if (!found) return null;
      if (cleaned) found.name = cleaned;
      else delete found.name;
      return found;
    });
    if (!item) return res.status(404).json({ error: `${words.item} not found` });
    logger.info(`${words.item} renamed`, { folder, id });
    res.json(item);
  }));

  // DELETE /…/:folder/<items>/:id
  router.delete('/:id', route(async (req, res) => {
    const { folder, id } = req.params;
    const item = await store.modifyItems(folder, (data) => {
      const idx = data[key].findIndex((s) => s.id === id);
      return idx === -1 ? null : data[key].splice(idx, 1)[0];
    });
    if (!item) return res.status(404).json({ error: `${words.item} not found` });

    store.removeItemFiles(folder, item);   // the file, and a video's thumbnail
    changed();
    logger.info(`${words.item} deleted`, { folder, id });
    res.json({ ok: true });
  }));

  // PUT /…/:folder/<items>/reorder
  // Body: { order: ['id1', 'id2', ...] }
  router.put('/reorder', route(async (req, res) => {
    const { folder } = req.params;
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: `order must be an array of ${words.idsLabel}` });

    const reordered = await store.modifyItems(folder, (data) => {
      const byId = Object.fromEntries(data[key].map((s) => [s.id, s]));
      // IDs in `order` come first (in given sequence), any remaining items appended
      data[key] = [
        ...order.filter((id) => byId[id]).map((id) => byId[id]),
        ...data[key].filter((s) => !order.includes(s.id)),
      ];
      return data[key];
    });
    changed();
    logger.info(`${words.items} reordered`, { folder });
    res.json(reordered);
  }));

  extend(router);

  // Upload errors (multer's, or a refused type): 400 with the reason
  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  });

  return router;
}

module.exports = { createItemsRouter };
