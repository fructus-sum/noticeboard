// server/services/playlistService.js — what the displays play
//
// Provides
//   buildPlaylist(active) → { slides: [{ type, url, duration, slideshow, length?, sound?, withSound?, lowerTo? }] }
//     For each active slideshow (the scheduler's list, in priority order), its ready slides.
//     The slideshow's settings come from config.json as it is now (the scheduler's copy may be
//     older). An image's duration: its own, else its slideshow's, else the default from Settings
//     (else 10 s); each slide carries its own, so a slideshow's last slide keeps its time.
//     A video's duration is null: it plays to the end; its length (seconds, null if unknown) is when
//     a screen that can't play it moves on (SYSTEM_DESIGN §3.5). A video being converted to another
//     format (reprocessing) stays in, with its current file. A video with its own sound on carries
//     sound: true, withSound and lowerTo (the background audio meanwhile, SYSTEM_DESIGN §18.3);
//     other slides don't have these keys.
//
// Used by
//   realtime/displaySocket.js
//
// Uses
//   slideshowStore, configService (the default duration), pathHelpers (mediaUrl)
//
// Change impact
//   The playlist is the viewer's contract, including screens still running an older viewer
//   (SYSTEM_DESIGN §15): keep its shape. The viewer compares whole playlists to decide
//   whether anything changed.
const configService = require('./configService');
const store = require('./slideshowStore');
const { mediaUrl } = require('../utils/pathHelpers');

function buildPlaylist(activeSlideshows) {
  const defaultDuration = configService.get('display')?.defaultSlideDurationSeconds ?? 10;
  const slides = [];

  for (const active of activeSlideshows) {
    const ss = store.find(active.folder) || active;
    // Ready slides, and videos being converted to another format (their current file still plays)
    for (const slide of store.readSlides(ss.folder).slides.filter((s) => s.status === 'ready' || (s.reprocessing && s.filename))) {
      slides.push({
        type: slide.type,
        url: mediaUrl(ss.folder, slide.filename),
        duration: slide.type === 'image' ? (slide.duration ?? ss.slideDurationSeconds ?? defaultDuration) : null,
        slideshow: ss.folder,
        // A video's length: a screen that can't play it still moves on at that time
        ...(slide.type === 'video' ? { length: slide.duration ?? null } : {}),
        ...(slide.type === 'video' && slide.sound === true ? { sound: true, withSound: slide.withSound, lowerTo: slide.lowerTo } : {}),
      });
    }
  }

  return { slides };
}

module.exports = { buildPlaylist };
