// server/services/slideshowStore.js — the one owner of the slideshows' data
//
// Responsibilities
//   The slideshow entries in config.json (config.slideshows) and each slideshow's folder
//   data/slideshows/<folder>/ with its slideshow.json and slides/. Every read and write of those
//   goes through here, so there is one reader, one writer and one lock (they were repeated in
//   five places). The file formats are unchanged: installed noticeboards keep their data as it is.
//
// Provides
//   list()                          → the entries (config.slideshows, [] if none)
//   find(folder)                    → one entry, or undefined
//   create({ name, priority, schedule }) → the new entry: an unpublished slideshow, its folder,
//                                     slides/ and an empty slideshow.json (written atomically)
//   replace(folder, entry)          → saves a changed entry in its place (null if none)
//   remove(folder)                  → removes the entry, then deletes the folder (false if none)
//   removeMany(folders)             → the entries removed: one config write, then their folders
//   commitEntries(entries, other)   one config write of the entries plus other keys (the sample
//                                     sync also records sampleSlideshow in the same write)
//   readSlides(folder)              → the parsed slideshow.json: { slides: [...] }. Missing or
//                                     broken → { slides: [] }; other keys are kept; a file without a
//                                     slides list counts as no slides (SYSTEM_DESIGN §14 D1)
//   modifySlides(folder, fn)        → fn's result. Locked read → fn(data) → written only if fn
//                                     changed data. Two updates never overwrite each other
//   slideCount(folder)              → number of slides
//   slideFileExists(folder, name)   → whether slides/<name> exists
//   removeSlideFiles(folder, slide) deletes a slide's media file and thumbnail, if present
//
// Used by
//   routes/api/slideshows.js, routes/api/slides.js, services/uploadQueue.js,
//   services/sampleSlideshow.js, services/playlistService.js, services/schedulerService.js
//
// Uses
//   configService (the entries; its 'change' event tells the scheduler and the displays),
//   utils/configIO (atomic JSON), utils/slideshowLock, utils/pathHelpers, utils/slugify
//
// Change impact
//   slideshow.json and the entries are read by the viewer's playlist, the admin panel and older
//   versions after a rollback: keep their shape (SYSTEM_DESIGN §5–6).
const fs = require('fs');
const path = require('path');
const configService = require('./configService');
const { writeConfig, readJsonFile } = require('../utils/configIO');
const { withSlideshowLock } = require('../utils/slideshowLock');
const { slideshowDir, slidesDir, slideshowJsonPath } = require('../utils/pathHelpers');
const { uniqueSlug } = require('../utils/slugify');

// ── Entries (config.slideshows) ───────────────────────────────────────────────

function list() {
  return configService.get('slideshows') || [];
}

function find(folder) {
  return list().find((s) => s.folder === folder);
}

async function create({ name, priority, schedule }) {
  const existing = list();
  const folder = uniqueSlug(name);
  fs.mkdirSync(slidesDir(folder), { recursive: true });
  await writeConfig(slideshowJsonPath(folder), { slides: [] });
  const entry = {
    folder,
    name,
    priority: typeof priority === 'number' ? priority : existing.length + 1,
    schedule: schedule || { type: 'always' },
    enabled: false,
    addedAt: new Date().toISOString(),
  };
  await configService.set('slideshows', [...existing, entry]);
  return entry;
}

async function replace(folder, entry) {
  const all = list();
  const idx = all.findIndex((s) => s.folder === folder);
  if (idx === -1) return null;
  const next = [...all];
  next[idx] = entry;
  await configService.set('slideshows', next);
  return entry;
}

async function remove(folder) {
  const all = list();
  const idx = all.findIndex((s) => s.folder === folder);
  if (idx === -1) return false;
  await configService.set('slideshows', all.filter((_, i) => i !== idx));
  const dir = slideshowDir(folder);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

async function removeMany(folders) {
  const gone = new Set(folders);
  const all = list();
  const removed = all.filter((s) => gone.has(s.folder));
  if (!removed.length) return [];
  await configService.set('slideshows', all.filter((s) => !gone.has(s.folder)));
  for (const { folder } of removed) {
    const dir = slideshowDir(folder);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  return removed;
}

function commitEntries(entries, other = {}) {
  return configService.update({ slideshows: entries, ...other });
}

// ── Slides (slideshow.json) ───────────────────────────────────────────────────

function readSlides(folder) {
  const data = readJsonFile(slideshowJsonPath(folder));
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { slides: [] };
  if (!Array.isArray(data.slides)) data.slides = [];
  return data;
}

// Wrap the whole read → change → write in the lock, and never nest it for the same folder
function modifySlides(folder, fn) {
  return withSlideshowLock(folder, async () => {
    const data = readSlides(folder);
    const before = JSON.stringify(data);
    const result = await fn(data);
    if (JSON.stringify(data) !== before) await writeConfig(slideshowJsonPath(folder), data);
    return result;
  });
}

function slideCount(folder) {
  return readSlides(folder).slides.length;
}

function slideFileExists(folder, name) {
  return !!name && fs.existsSync(path.join(slidesDir(folder), name));
}

function removeSlideFiles(folder, slide) {
  for (const name of [slide.filename, slide.thumbnail]) {
    if (name) fs.rmSync(path.join(slidesDir(folder), name), { force: true });
  }
}

module.exports = {
  list,
  find,
  create,
  replace,
  remove,
  removeMany,
  commitEntries,
  readSlides,
  modifySlides,
  slideCount,
  slideFileExists,
  removeSlideFiles,
};
