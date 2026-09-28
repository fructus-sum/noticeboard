// server/routes/api/audioshows.js — /api/audioshows: the audio shows (SYSTEM_DESIGN §18.3)
//
// Responsibilities
//   List (with each show's track count), create (unpublished, default settings), read, change
//   (name, published, order, transition, fade length, volume: checked by audioShowRules) and delete.
//   Mounted behind the admin check (api/index.js), with the tracks' routes inside it.
//
// Used by
//   routes/api/index.js; the admin panel (AudioShowsView, AudioShowDetailView)
//
// Uses
//   services/audioShowStore, services/audioShowRules, middleware/asyncRoute, utils/logger
//
// Change impact
//   The entries are config.audioShows (SYSTEM_DESIGN §5.1); the displays will read them once audio
//   plays on them.
const express = require('express');
const store = require('../../services/audioShowStore');
const rules = require('../../services/audioShowRules');
const { route } = require('../../middleware/asyncRoute');
const logger = require('../../utils/logger');

const router = express.Router();

// Adds what the admin panel shows but config.json doesn't store
const describe = (show) => ({ ...show, trackCount: store.itemCount(show.folder) });

router.get('/', (req, res) => {
  res.json(store.list().map(describe));
});

router.post('/', route(async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const entry = await store.create({ name: name.trim() });
  logger.info('Audio show created', { folder: entry.folder, name: entry.name });
  res.status(201).json(describe(entry));
}));

router.get('/:folder', (req, res) => {
  const show = store.find(req.params.folder);
  if (!show) return res.status(404).json({ error: 'Audio show not found' });
  res.json(describe(show));
});

router.put('/:folder', route(async (req, res) => {
  const before = store.find(req.params.folder);
  if (!before) return res.status(404).json({ error: 'Audio show not found' });
  const { entry, error } = rules.applyChange(before, req.body);
  if (error) return res.status(400).json({ error });
  await store.replace(req.params.folder, entry);
  logger.info('Audio show updated', { folder: req.params.folder });
  res.json(describe(entry));
}));

router.delete('/:folder', route(async (req, res) => {
  if (!store.find(req.params.folder)) return res.status(404).json({ error: 'Audio show not found' });
  await store.remove(req.params.folder);
  logger.info('Audio show deleted', { folder: req.params.folder });
  res.json({ ok: true });
}));

module.exports = router;
