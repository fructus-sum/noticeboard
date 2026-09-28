// server/services/audioPlaylist.js — what the displays play in the background (SYSTEM_DESIGN §18.3)
//
// Provides
//   buildAudio({ event }) → { shows, slideshows, event }, the audio:update payload:
//     shows       { <audio show folder>: { id, order, transition, fadeSeconds, volume,
//                   tracks: [{ url, length }] } }: the published audio shows with at least one
//                   ready track, each exactly as shared/audioPlayer.mjs takes it (length: seconds,
//                   null if unknown)
//     slideshows  { <slideshow folder>: <audio show folder> }: the slideshows whose audio show is
//                 in shows (published or not: which slideshows are on air is the playlist's job)
//     event       the audio show whose event is playing (services/audioEventClock gives it), if it
//                 is in shows; else null
//
// Used by
//   realtime/displaySocket.js
//
// Uses
//   audioShowStore, slideshowStore, pathHelpers (audioUrl)
//
// Change impact
//   The payload is a contract with open screens (SYSTEM_DESIGN §15): keys may only be added. The
//   socket compares whole payloads to decide whether to send it again.
const audioShowStore = require('./audioShowStore');
const slideshowStore = require('./slideshowStore');
const { audioUrl } = require('../utils/pathHelpers');

function buildAudio({ event = null } = {}) {
  const shows = {};
  for (const show of audioShowStore.list()) {
    if (show.enabled !== true) continue;
    const tracks = audioShowStore.readItems(show.folder).tracks
      .filter((t) => t.status === 'ready' && t.filename)
      .map((t) => ({ url: audioUrl(show.folder, t.filename), length: t.duration ?? null }));
    if (!tracks.length) continue;
    shows[show.folder] = {
      id: show.folder,
      order: show.order,
      transition: show.transition,
      fadeSeconds: show.fadeSeconds,
      volume: show.volume,
      tracks,
    };
  }

  const slideshows = {};
  for (const ss of slideshowStore.list()) {
    if (ss.audioShow && shows[ss.audioShow]) slideshows[ss.folder] = ss.audioShow;
  }

  return { shows, slideshows, event: event && shows[event] ? event : null };
}

module.exports = { buildAudio };
