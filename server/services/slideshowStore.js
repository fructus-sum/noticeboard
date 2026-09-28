// server/services/slideshowStore.js — the one owner of the slideshows' data
//
// Responsibilities
//   The slideshow entries in config.json (config.slideshows) and each slideshow's folder
//   data/slideshows/<folder>/ with its slideshow.json and slides/: a show store (services/showStore)
//   for slideshows, under the names the rest of the server uses. The file formats are unchanged:
//   installed noticeboards keep their data as it is.
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
//   store                           the show store itself (its generic names: readItems,
//                                     modifyItems…), for code shared by every kind of show
//
// Used by
//   routes/api/slideshows.js, routes/api/slides.js, services/uploadQueue.js,
//   services/sampleSlideshow.js, services/playlistService.js, services/schedulerService.js,
//   services/contentReset.js (removeMany: Delete All), services/videoConversion.js
//
// Uses
//   services/showStore (createShowStore), utils/pathHelpers (slideshowsDir)
//
// Change impact
//   slideshow.json and the entries are read by the viewer's playlist, the admin panel and older
//   versions after a rollback: keep their shape (SYSTEM_DESIGN §5–6).
const { createShowStore } = require('./showStore');
const { slideshowsDir } = require('../utils/pathHelpers');

const store = createShowStore({
  kind: 'slideshow',
  configKey: 'slideshows',
  rootDir: slideshowsDir,
  fileName: 'slideshow.json',
  itemsKey: 'slides',
  mediaDirName: 'slides',
  fallbackSlug: 'slideshow',
  // A new slideshow: unpublished, always on, after the others
  newEntry: ({ name, priority, schedule }, existing) => ({
    name,
    priority: typeof priority === 'number' ? priority : existing.length + 1,
    schedule: schedule || { type: 'always' },
    enabled: false,
  }),
});

module.exports = {
  list: store.list,
  find: store.find,
  create: store.create,
  replace: store.replace,
  remove: store.remove,
  removeMany: store.removeMany,
  commitEntries: store.commitEntries,
  readSlides: store.readItems,
  modifySlides: store.modifyItems,
  slideCount: store.itemCount,
  slideFileExists: store.itemFileExists,
  removeSlideFiles: store.removeItemFiles,
  store,
};
