const express = require('express');
const fs = require('fs');
const configService = require('../../services/configService');
const { slideshowDir, slideshowJsonPath, slidesDir } = require('../../utils/pathHelpers');
const { uniqueSlug } = require('../../utils/slugify');
const logger = require('../../utils/logger');

const router = express.Router();

function readSlideshowJson(folder) {
  const p = slideshowJsonPath(folder);
  if (!fs.existsSync(p)) return { slides: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { slides: [] };
  }
}

router.get('/', (req, res) => {
  const list = configService.get('slideshows') || [];
  res.json(list.map(ss => ({
    ...ss,
    slideCount: readSlideshowJson(ss.folder).slides.length,
  })));
});

router.post('/', async (req, res, next) => {
  try {
    const { name, priority, schedule } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const existing = configService.get('slideshows') || [];
    const folder = uniqueSlug(name.trim());

    fs.mkdirSync(slidesDir(folder), { recursive: true });
    fs.writeFileSync(slideshowJsonPath(folder), JSON.stringify({ slides: [] }, null, 2));

    const entry = {
      folder,
      name: name.trim(),
      priority: typeof priority === 'number' ? priority : existing.length + 1,
      schedule: schedule || { type: 'always' },
      addedAt: new Date().toISOString(),
    };

    await configService.set('slideshows', [...existing, entry]);
    logger.info('Slideshow created', { folder, name: entry.name });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.put('/:folder', async (req, res, next) => {
  try {
    const list = configService.get('slideshows') || [];
    const idx = list.findIndex(s => s.folder === req.params.folder);
    if (idx === -1) return res.status(404).json({ error: 'Slideshow not found' });

    const updated = { ...list[idx] };
    for (const key of ['name', 'priority', 'schedule']) {
      if (req.body[key] !== undefined) updated[key] = req.body[key];
    }

    const newList = [...list];
    newList[idx] = updated;
    await configService.set('slideshows', newList);
    logger.info('Slideshow updated', { folder: req.params.folder });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:folder', async (req, res, next) => {
  try {
    const list = configService.get('slideshows') || [];
    const idx = list.findIndex(s => s.folder === req.params.folder);
    if (idx === -1) return res.status(404).json({ error: 'Slideshow not found' });

    await configService.set('slideshows', list.filter((_, i) => i !== idx));

    const dir = slideshowDir(req.params.folder);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

    logger.info('Slideshow deleted', { folder: req.params.folder });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
