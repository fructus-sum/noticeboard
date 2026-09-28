// server/routes/api/tracks.js — /api/audioshows/:folder/tracks: an audio show's tracks
//
// Responsibilities
//   The routes every show's items share (routes/api/mediaItems.js) for audio tracks: upload (MP3,
//   WAV, Ogg, AAC/M4A, FLAC, Opus…, converted to AAC with even loudness), list, rename, delete,
//   reorder. Mounted inside the audio shows API, behind its admin check (SYSTEM_DESIGN §18.3).
//
// Used by
//   routes/api/index.js; the admin panel (TrackList)
//
// Uses
//   routes/api/mediaItems (createItemsRouter), services/audioShowStore, services/mediaTypes
//   (AUDIO_MIME), services/uploadQueue (enqueueProcessing)
const store = require('../../services/audioShowStore');
const { AUDIO_MIME } = require('../../services/mediaTypes');
const { enqueueProcessing } = require('../../services/uploadQueue');
const { createItemsRouter } = require('./mediaItems');

module.exports = createItemsRouter({
  store,
  allowed: AUDIO_MIME,
  words: { show: 'Audio show', item: 'Track', items: 'Tracks', idsLabel: 'track IDs' },
  // The screens don't play audio yet: nothing to announce when a track is ready or removed
  enqueue: ({ folder, id, tmpPath, mime }) => enqueueProcessing({ store, folder, slideId: id, tmpPath, mime, changed: () => {} }),
});
