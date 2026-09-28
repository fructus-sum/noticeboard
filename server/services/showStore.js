// server/services/showStore.js — one owner for each kind of show's data (slideshows, audio shows)
//
// Responsibilities
//   A kind of show is a list of entries in config.json (config[configKey]) and, for each entry, a
//   folder <rootDir>/<folder>/ holding a JSON file (<fileName>: { [itemsKey]: [...] }) and the
//   items' files (<mediaDirName>/). Every read and write of those goes through the store made here,
//   so there is one reader, one writer and one lock per kind (SYSTEM_DESIGN §14 D1–D3). The file
//   formats are the ones each kind already has.
//
// Provides
//   createShowStore({ kind, configKey, rootDir, fileName, itemsKey, mediaDirName, fallbackSlug,
//                     newEntry }) → a store:
//     list()                          → the entries ([] if none)
//     find(folder)                    → one entry, or undefined
//     create(fields)                  → the new entry: newEntry(fields, existing) plus folder and
//                                       addedAt, its folder, the media folder and an empty JSON file
//                                       (written atomically)
//     replace(folder, entry)          → saves a changed entry in its place (null if none)
//     remove(folder, other)           → removes the entry (with other keys, if given, in the same
//                                       config write), then deletes the folder (false if none)
//     removeMany(folders)             → the entries removed: one config write, then their folders
//     commitEntries(entries, other)   one config write of the entries plus other keys
//     readItems(folder)               → the parsed JSON file: { [itemsKey]: [...] }. Missing or broken
//                                       → an empty list; other keys are kept; a file without the list
//                                       counts as empty
//     modifyItems(folder, fn)         → fn's result. Locked read → fn(data) → written only if fn
//                                       changed data. Two updates never overwrite each other
//     itemCount(folder)               → how many items
//     itemFileExists(folder, name)    → whether <mediaDirName>/<name> exists
//     removeItemFiles(folder, item)   deletes an item's file and thumbnail, if present
//     itemsKey, mediaDir(folder)      the list's key, and where an entry's files are
//
// Used by
//   services/slideshowStore (the slideshows), services/audioShowStore (the audio shows)
//
// Uses
//   configService (the entries; its 'change' event tells the scheduler and the displays),
//   utils/configIO (atomic JSON), utils/folderLock, utils/slugify
//
// Change impact
//   The JSON files and entries are read by the displays, the admin panel and older versions after a
//   rollback: a store must keep its kind's shapes (SYSTEM_DESIGN §5–6).
const fs = require('fs');
const path = require('path');
const configService = require('./configService');
const { writeConfig, readJsonFile } = require('../utils/configIO');
const { withFolderLock } = require('../utils/folderLock');
const { uniqueSlug } = require('../utils/slugify');

function createShowStore({ kind, configKey, rootDir, fileName, itemsKey, mediaDirName, fallbackSlug, newEntry }) {
  const folderDir = (folder) => path.join(rootDir(), folder);
  const mediaDir = (folder) => path.join(folderDir(folder), mediaDirName);
  const jsonPath = (folder) => path.join(folderDir(folder), fileName);

  // ── Entries (config[configKey]) ─────────────────────────────────────────────

  function list() {
    return configService.get(configKey) || [];
  }

  function find(folder) {
    return list().find((s) => s.folder === folder);
  }

  async function create(fields) {
    const existing = list();
    const folder = uniqueSlug(fields.name, { dir: rootDir(), fallback: fallbackSlug });
    fs.mkdirSync(mediaDir(folder), { recursive: true });
    await writeConfig(jsonPath(folder), { [itemsKey]: [] });
    const entry = { folder, ...newEntry(fields, existing), addedAt: new Date().toISOString() };
    await configService.set(configKey, [...existing, entry]);
    return entry;
  }

  async function replace(folder, entry) {
    const all = list();
    const idx = all.findIndex((s) => s.folder === folder);
    if (idx === -1) return null;
    const next = [...all];
    next[idx] = entry;
    await configService.set(configKey, next);
    return entry;
  }

  async function remove(folder, other = null) {
    const all = list();
    const idx = all.findIndex((s) => s.folder === folder);
    if (idx === -1) return false;
    const rest = all.filter((_, i) => i !== idx);
    if (other) await configService.update({ [configKey]: rest, ...other });
    else await configService.set(configKey, rest);
    const dir = folderDir(folder);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  async function removeMany(folders) {
    const gone = new Set(folders);
    const all = list();
    const removed = all.filter((s) => gone.has(s.folder));
    if (!removed.length) return [];
    await configService.set(configKey, all.filter((s) => !gone.has(s.folder)));
    for (const { folder } of removed) {
      const dir = folderDir(folder);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    return removed;
  }

  function commitEntries(entries, other = {}) {
    return configService.update({ [configKey]: entries, ...other });
  }

  // ── Items (the JSON file) ───────────────────────────────────────────────────

  function readItems(folder) {
    const data = readJsonFile(jsonPath(folder));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { [itemsKey]: [] };
    if (!Array.isArray(data[itemsKey])) data[itemsKey] = [];
    return data;
  }

  // Wrap the whole read → change → write in the lock, and never nest it for the same folder
  function modifyItems(folder, fn) {
    return withFolderLock(`${kind}:${folder}`, async () => {
      const data = readItems(folder);
      const before = JSON.stringify(data);
      const result = await fn(data);
      if (JSON.stringify(data) !== before) await writeConfig(jsonPath(folder), data);
      return result;
    });
  }

  function itemCount(folder) {
    return readItems(folder)[itemsKey].length;
  }

  function itemFileExists(folder, name) {
    return !!name && fs.existsSync(path.join(mediaDir(folder), name));
  }

  function removeItemFiles(folder, item) {
    for (const name of [item.filename, item.thumbnail]) {
      if (name) fs.rmSync(path.join(mediaDir(folder), name), { force: true });
    }
  }

  return {
    kind, itemsKey, mediaDir,
    list, find, create, replace, remove, removeMany, commitEntries,
    readItems, modifyItems, itemCount, itemFileExists, removeItemFiles,
  };
}

module.exports = { createShowStore };
