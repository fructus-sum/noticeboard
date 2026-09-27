// /api/slideshows: the admin panel's list of slideshows, creating, changing and deleting them.
// The data belongs to services/slideshowStore.js, the rules to services/slideshowRules.js.
const express = require('express');
const store = require('../../services/slideshowStore');
const rules = require('../../services/slideshowRules');
const { route } = require('../../middleware/asyncRoute');
const { broadcastPlaylist } = require('../../socket');
const logger = require('../../utils/logger');

const router = express.Router();

// Adds what the admin panel shows but config.json doesn't store
function describe(ss) {
  return { ...ss, sample: rules.isSample(ss.folder), slideCount: store.slideCount(ss.folder) };
}

router.get('/', (req, res) => {
  res.json(store.list().map(describe));
});

router.post('/', route(async (req, res) => {
  const { name, priority, schedule } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const entry = await store.create({ name: name.trim(), priority, schedule });
  logger.info('Slideshow created', { folder: entry.folder, name: entry.name });
  res.status(201).json(entry);
}));

router.get('/:folder', (req, res) => {
  const ss = store.find(req.params.folder);
  if (!ss) return res.status(404).json({ error: 'Slideshow not found' });
  res.json(describe(ss));
});

router.put('/:folder', route(async (req, res) => {
  const before = store.find(req.params.folder);
  if (!before) return res.status(404).json({ error: 'Slideshow not found' });

  const updated = { ...before };
  for (const key of ['name', 'priority', 'schedule', 'enabled', 'hidden', 'slideDurationSeconds']) {
    if (req.body[key] !== undefined) updated[key] = req.body[key];
  }
  // null: use the default duration from Settings
  if (updated.slideDurationSeconds !== undefined && updated.slideDurationSeconds !== null) {
    const seconds = rules.parseSlideSeconds(updated.slideDurationSeconds);
    if (seconds.error) return res.status(400).json({ error: seconds.error });
    updated.slideDurationSeconds = seconds.value;
  }
  const refused = rules.applyHiddenRule(before, updated);
  if (refused) return res.status(refused.status).json({ error: refused.error });

  await store.replace(req.params.folder, updated);
  // e.g. a new duration for a slideshow on air; displays ignore a playlist that hasn't changed
  broadcastPlaylist();
  logger.info('Slideshow updated', { folder: req.params.folder });
  res.json(updated);
}));

router.delete('/:folder', route(async (req, res) => {
  if (!store.find(req.params.folder)) return res.status(404).json({ error: 'Slideshow not found' });
  if (rules.isSample(req.params.folder)) {
    return res.status(403).json({ error: rules.SAMPLE_DELETE_ERROR });
  }
  await store.remove(req.params.folder);
  logger.info('Slideshow deleted', { folder: req.params.folder });
  res.json({ ok: true });
}));

module.exports = router;
