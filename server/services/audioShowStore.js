// server/services/audioShowStore.js — the one owner of the audio shows' data
//
// Responsibilities
//   The audio show entries in config.json (config.audioShows) and each show's folder
//   data/audioshows/<folder>/ with its audioshow.json ({ tracks: [...] }) and tracks/: a show store
//   (services/showStore) for audio shows (SYSTEM_DESIGN §18.3).
//
// Provides
//   The show store's functions (list, find, create, replace, remove, removeMany, commitEntries,
//   readItems, modifyItems, itemCount, itemFileExists, removeItemFiles, itemsKey 'tracks',
//   mediaDir). create({ name }) makes an unpublished show with the default settings (in order, no
//   transition, the contract's fade length and volume).
//
// Used by
//   routes/api/audioshows.js, routes/api/tracks.js, services/uploadQueue (through the tracks route)
//
// Uses
//   services/showStore (createShowStore), utils/pathHelpers (audioShowsDir), shared/contract.json
//   (the audio defaults)
const { createShowStore } = require('./showStore');
const { audioShowsDir } = require('../utils/pathHelpers');
const { audio: AUDIO } = require('../../shared/contract.json');

module.exports = createShowStore({
  kind: 'audioshow',
  configKey: 'audioShows',
  rootDir: audioShowsDir,
  fileName: 'audioshow.json',
  itemsKey: 'tracks',
  mediaDirName: 'tracks',
  fallbackSlug: 'audio-show',
  newEntry: ({ name }) => ({
    name,
    enabled: false,
    order: AUDIO.orders[0],
    transition: AUDIO.transitions[0],
    fadeSeconds: AUDIO.fadeSeconds.default,
    volume: AUDIO.volume.default,
  }),
});
