const express = require('express');
const fs = require('fs');
const configService = require('../../services/configService');
const { slideshowDir, slideshowJsonPath, slidesDir } = require('../../utils/pathHelpers');
const { uniqueSlug } = require('../../utils/slugify');
const { broadcastPlaylist } = require('../../socket');
const logger = require('../../utils/logger');

const router = express.Router();

// The sample slideshow can be hidden, but never deleted (see services/sampleSlideshow.js)
function isSample(folder) {
  return configService.get('sampleSlideshow')?.folder === folder;
}

// Adds what the admin panel shows but config.json doesn't store
function describe(ss) {
  return { ...ss, sample: isSample(ss.folder), slideCount: readSlideshowJson(ss.folder).slides.length };
}

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
  res.json(list.map(describe));
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
      enabled: false,
      addedAt: new Date().toISOString(),
    };

    await configService.set('slideshows', [...existing, entry]);
    logger.info('Slideshow created', { folder, name: entry.name });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.get('/:folder', (req, res) => {
  const list = configService.get('slideshows') || [];
  const ss = list.find(s => s.folder === req.params.folder);
  if (!ss) return res.status(404).json({ error: 'Slideshow not found' });
  res.json(describe(ss));
});

router.put('/:folder', async (req, res, next) => {
  try {
    const list = configService.get('slideshows') || [];
    const idx = list.findIndex(s => s.folder === req.params.folder);
    if (idx === -1) return res.status(404).json({ error: 'Slideshow not found' });

    const updated = { ...list[idx] };
    for (const key of ['name', 'priority', 'schedule', 'enabled', 'hidden', 'slideDurationSeconds']) {
      if (req.body[key] !== undefined) updated[key] = req.body[key];
    }
    // null: use the default duration from Settings
    if (updated.slideDurationSeconds !== undefined && updated.slideDurationSeconds !== null) {
      const seconds = Number(updated.slideDurationSeconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
        return res.status(400).json({ error: 'The slide duration must be a whole number of seconds from 1 to 3600' });
      }
      updated.slideDurationSeconds = seconds;
    }
    // Hiding only tidies the list: a hidden slideshow is kept exactly as it is, and only one
    // that isn't published can be hidden (or stay hidden)
    updated.hidden = updated.hidden === true;
    if (updated.hidden && updated.enabled !== false) {
      return res.status(409).json({
        error: list[idx].hidden ? 'Unhide this slideshow before publishing it.' : 'Only unpublished slideshows can be hidden. Disable it first.',
      });
    }
    if (!updated.hidden) delete updated.hidden;

    const newList = [...list];
    newList[idx] = updated;
    await configService.set('slideshows', newList);
    // e.g. a new duration for a slideshow on air; displays ignore a playlist that hasn't changed
    broadcastPlaylist();
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
    if (isSample(req.params.folder)) {
      return res.status(403).json({ error: "The sample slideshow can't be deleted. You can hide it instead." });
    }

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
