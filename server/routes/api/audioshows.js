// server/routes/api/audioshows.js — /api/audioshows: the audio shows (SYSTEM_DESIGN §18.3)
//
// Responsibilities
//   List (with each show's track count), create (unpublished, default settings), read, change
//   (name, published, order, transition, fade length, volume: checked by audioShowRules) and delete
//   (which also clears it from the slideshows that chose it, in the same config write); its event
//   audio: PUT /:folder/event (audioShowRules.parseEvent: checked, overlaps refused), and each show
//   described with its eventState (services/audioEvents).
//   Mounted behind the admin check (api/index.js), with the tracks' routes inside it.
//
// Used by
//   routes/api/index.js; the admin panel (AudioShowsView, AudioShowDetailView)
//
// Uses
//   services/audioShowStore, services/audioShowRules, services/audioEvents (eventState),
//   services/slideshowStore (clearing a deleted show), middleware/asyncRoute, utils/logger
//
// Change impact
//   The entries are config.audioShows (SYSTEM_DESIGN §5.1); the displays hear of a change through
//   the config change (services/audioPlaylist).
const express = require('express');
const store = require('../../services/audioShowStore');
const rules = require('../../services/audioShowRules');
const slideshowStore = require('../../services/slideshowStore');
const { eventState } = require('../../services/audioEvents');
const { route } = require('../../middleware/asyncRoute');
const logger = require('../../utils/logger');

const router = express.Router();

// Adds what the admin panel shows but config.json doesn't store
const describe = (show) => ({
  ...show,
  trackCount: store.itemCount(show.folder),
  eventState: eventState(show.folder, store.list(), new Date()),
});

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

// PUT /api/audioshows/:folder/event
// Body: { mode: 'now' } | { mode: 'once', from, to } | { mode: 'repeat', days, startTime, endTime } |
// null (none). A scheduled event that overlaps another show's is refused (409).
router.put('/:folder/event', route(async (req, res) => {
  const before = store.find(req.params.folder);
  if (!before) return res.status(404).json({ error: 'Audio show not found' });
  const { event, error, status } = rules.parseEvent(req.body?.event === undefined ? req.body : req.body.event, before.folder, store.list());
  if (error) return res.status(status ?? 400).json({ error });
  const entry = { ...before };
  if (event) entry.event = event;
  else delete entry.event;
  await store.replace(before.folder, entry);
  logger.info('Audio show event set', { folder: before.folder, event: event?.mode ?? null });
  res.json(describe(entry));
}));

router.delete('/:folder', route(async (req, res) => {
  if (!store.find(req.params.folder)) return res.status(404).json({ error: 'Audio show not found' });
  const { folder } = req.params;
  const slideshows = slideshowStore.list();
  const users = slideshows.filter((ss) => ss.audioShow === folder);
  const other = users.length
    ? { slideshows: slideshows.map((ss) => { if (ss.audioShow !== folder) return ss; const { audioShow, ...rest } = ss; return rest; }) }
    : null;
  await store.remove(folder, other);
  logger.info('Audio show deleted', { folder, clearedFrom: users.map((ss) => ss.folder) });
  res.json({ ok: true });
}));

module.exports = router;
