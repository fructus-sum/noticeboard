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
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { folder } = req.params;
    const mime = req.file.mimetype;
    const type = typeFromMime(mime);
    const slideId = crypto.randomUUID();

    // Write a placeholder entry so the SPA can show a progress indicator
    const data = readSlideshowJson(folder);
    const entry = {
      id: slideId,
      type,
      filename: null,
      status: 'processing',
      duration: null,
      addedAt: new Date().toISOString(),
    };
    data.slides.push(entry);
    await writeConfig(slideshowJsonPath(folder), data);

    enqueueProcessing({ folder, slideId, tmpPath: req.file.path, mime });

    logger.info('Slide upload accepted', { folder, slideId, type, ...queueSize() });
    res.status(202).json(entry);
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

// Error handler for multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
