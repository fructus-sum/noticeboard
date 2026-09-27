const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { writeConfig } = require('../../utils/configIO');
const { slideshowJsonPath, slidesDir, tmpDir } = require('../../utils/pathHelpers');
const { typeFromMime, IMAGE_MIME, VIDEO_MIME } = require('../../services/mediaService');
const { enqueueProcessing, enqueueThumbnail, queueSize } = require('../../services/uploadQueue');
const configService = require('../../services/configService');
const logger = require('../../utils/logger');
const { withSlideshowLock } = require('../../utils/slideshowLock');
const { broadcastPlaylist } = require('../../socket');

const router = express.Router({ mergeParams: true });

const ALLOWED_MIME = new Set([...IMAGE_MIME, ...VIDEO_MIME]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = tmpDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '';
    cb(null, `upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    const err = Object.assign(new Error('Unsupported file type'), { status: 400 });
    cb(err);
  },
});

// Verify slideshow exists before handling any slide routes
router.use((req, res, next) => {
  const list = configService.get('slideshows') || [];
  if (!list.find(s => s.folder === req.params.folder)) {
    return res.status(404).json({ error: 'Slideshow not found' });
  }
  next();
});

function readSlideshowJson(folder) {
  const p = slideshowJsonPath(folder);
  if (!fs.existsSync(p)) return { slides: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { slides: [] }; }
}

// GET /api/slideshows/:folder/slides
router.get('/', (req, res) => {
  res.json(readSlideshowJson(req.params.folder).slides);
});

// POST /api/slideshows/:folder/slides
router.post('/', upload.array('files', 50), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const { folder } = req.params;
    const queued = [];

    for (const file of req.files) {
      const slideId = crypto.randomUUID();
      const type = typeFromMime(file.mimetype);
      const entry = {
        id: slideId,
        type,
        filename: null,
        status: 'processing',
        duration: null,
        addedAt: new Date().toISOString(),
      };
      queued.push({ entry, slideId, tmpPath: file.path, mime: file.mimetype });
    }

    await withSlideshowLock(folder, async () => {
      const data = readSlideshowJson(folder);
      data.slides.push(...queued.map(q => q.entry));
      await writeConfig(slideshowJsonPath(folder), data);
    });

    for (const { slideId, tmpPath, mime } of queued) {
      enqueueProcessing({ folder, slideId, tmpPath, mime });
    }

    logger.info('Slides upload accepted', { folder, count: queued.length, ...queueSize() });
    res.status(202).json(queued.map(q => q.entry));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/slideshows/:folder/slides/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { folder, id } = req.params;
    const slide = await withSlideshowLock(folder, async () => {
      const data = readSlideshowJson(folder);
      const idx = data.slides.findIndex(s => s.id === id);
      if (idx === -1) return null;
      const [removed] = data.slides.splice(idx, 1);
      await writeConfig(slideshowJsonPath(folder), data);
      return removed;
    });
    if (!slide) return res.status(404).json({ error: 'Slide not found' });

    // Delete the media file (and a video's thumbnail) if they exist
    for (const name of [slide.filename, slide.thumbnail]) {
      if (!name) continue;
      const filePath = path.join(slidesDir(folder), name);
      if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    }

    configService.emit('change');
    broadcastPlaylist();   // displays drop it once the slide on screen has had its time
    logger.info('Slide deleted', { folder, id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/slideshows/:folder/slides/thumbnails
// Creates the missing thumbnails of this slideshow's videos, from a frame the server picks
router.post('/thumbnails', async (req, res, next) => {
  try {
    const { folder } = req.params;
    const missing = await withSlideshowLock(folder, async () => {
      const data = readSlideshowJson(folder);
      const videos = data.slides.filter((s) => s.type === 'video' && s.status === 'ready' && s.filename
        && !s.thumbnailPending && !(s.thumbnail && fs.existsSync(path.join(slidesDir(folder), s.thumbnail))));
      for (const s of videos) {
        s.thumbnailPending = true;
        delete s.thumbnail;
        delete s.thumbnailError;
      }
      if (videos.length) await writeConfig(slideshowJsonPath(folder), data);
      return videos;
    });
    for (const s of missing) enqueueThumbnail({ folder, slideId: s.id, filename: s.filename });
    logger.info('Missing video thumbnails queued', { folder, count: missing.length });
    res.status(202).json({ queued: missing.length });
  } catch (err) {
    next(err);
  }
});

// PUT /api/slideshows/:folder/slides/reorder
// Body: { order: ['id1', 'id2', ...] }
router.put('/reorder', async (req, res, next) => {
  try {
    const { folder } = req.params;
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of slide IDs' });

    const reordered = await withSlideshowLock(folder, async () => {
      const data = readSlideshowJson(folder);
      const byId = Object.fromEntries(data.slides.map(s => [s.id, s]));

      // Reorder: IDs in `order` come first (in given sequence), any remaining slides appended
      const slides = [
        ...order.filter(id => byId[id]).map(id => byId[id]),
        ...data.slides.filter(s => !order.includes(s.id)),
      ];

      await writeConfig(slideshowJsonPath(folder), { ...data, slides });
      return slides;
    });
    configService.emit('change');
    broadcastPlaylist();   // the new order starts once the slide on screen has had its time
    logger.info('Slides reordered', { folder });
    res.json(reordered);
  } catch (err) {
    next(err);
  }
});

// Error handler for multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
