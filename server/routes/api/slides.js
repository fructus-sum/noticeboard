const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { writeConfig } = require('../../utils/configIO');
const { slideshowJsonPath, slidesDir, tmpDir } = require('../../utils/pathHelpers');
const { typeFromMime, IMAGE_MIME, VIDEO_MIME } = require('../../services/mediaService');
const { enqueueProcessing, queueSize } = require('../../services/uploadQueue');
const configService = require('../../services/configService');
const logger = require('../../utils/logger');

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
    const data = readSlideshowJson(folder);
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
      data.slides.push(entry);
      queued.push({ entry, slideId, tmpPath: file.path, mime: file.mimetype });
    }

    await writeConfig(slideshowJsonPath(folder), data);

    for (const { slideId, tmpPath, mime } of queued) {
      enqueueProcessing({ folder, slideId, tmpPath, mime });
    }

    logger.info('Slides upload accepted', { folder, count: queued.length, ...queueSize() });
    res.status(202).json(queued.map(q => q.entry));
  } catch (err) {
    next(err);
  }
});

// POST /api/slideshows/:folder/slides/text
// Body: { overlay, bgColor, duration }
router.post('/text', async (req, res, next) => {
  try {
    const { folder } = req.params;
    const { overlay, bgColor, duration } = req.body;

    if (!overlay?.text?.trim()) return res.status(400).json({ error: 'overlay.text is required' });

    const data = readSlideshowJson(folder);
    const entry = {
      id: crypto.randomUUID(),
      type: 'text',
      filename: null,
      status: 'ready',
      duration: duration ?? 10,
      addedAt: new Date().toISOString(),
      bgColor: bgColor ?? '#1e293b',
      overlay,
    };
    data.slides.push(entry);
    await writeConfig(slideshowJsonPath(folder), data);
    configService.emit('change');
    logger.info('Text slide created', { folder, id: entry.id });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/slideshows/:folder/slides/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { folder, id } = req.params;
    const data = readSlideshowJson(folder);
    const idx = data.slides.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Slide not found' });

    const slide = data.slides[idx];
    data.slides.splice(idx, 1);
    await writeConfig(slideshowJsonPath(folder), data);

    // Delete the media file if it exists
    if (slide.filename) {
      const filePath = path.join(slidesDir(folder), slide.filename);
      if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    }

    configService.emit('change');
    logger.info('Slide deleted', { folder, id });
    res.json({ ok: true });
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

    const data = readSlideshowJson(folder);
    const byId = Object.fromEntries(data.slides.map(s => [s.id, s]));

    // Reorder: IDs in `order` come first (in given sequence), any remaining slides appended
    const reordered = [
      ...order.filter(id => byId[id]).map(id => byId[id]),
      ...data.slides.filter(s => !order.includes(s.id)),
    ];

    await writeConfig(slideshowJsonPath(folder), { ...data, slides: reordered });
    configService.emit('change');
    logger.info('Slides reordered', { folder });
    res.json(reordered);
  } catch (err) {
    next(err);
  }
});

// PUT /api/slideshows/:folder/slides/:id
// Body: { overlay, duration, bgColor } — patch allowed fields; overlay:null clears it
router.put('/:id', async (req, res, next) => {
  try {
    const { folder, id } = req.params;
    const data = readSlideshowJson(folder);
    const slide = data.slides.find(s => s.id === id);
    if (!slide) return res.status(404).json({ error: 'Slide not found' });

    const allowed = ['overlay', 'duration', 'bgColor'];
    for (const key of allowed) {
      if (key in req.body) {
        if (req.body[key] === null) {
          delete slide[key];
        } else {
          slide[key] = req.body[key];
        }
      }
    }

    await writeConfig(slideshowJsonPath(folder), data);
    configService.emit('change');
    logger.info('Slide updated', { folder, id });
    res.json(slide);
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
