// server/services/mediaNames.js — the names people see for uploaded media
//
// Responsibilities
//   The one rule for a media name (SYSTEM_DESIGN §14 D38): trimmed, without control characters, at
//   most limits.mediaNameMax characters (shared/contract.json, which the admin panel's input uses
//   too). Names are for people only: the stored files keep their own names, and names never reach
//   the screens.
//
// Provides
//   MAX_LENGTH                  the longest name allowed (from contract.json)
//   cleanName(value)            → the name as it's stored ('' when nothing is left). Not cut short:
//                                 the caller decides what a name that's too long means
//   nameFromUpload(original)    → an uploaded file's own name, cleaned and cut to MAX_LENGTH
//                                 (a file is never refused for its name), or null when it has none
//
// Used by
//   routes/api/mediaItems.js (uploads and renaming), services/sampleSlideshow.js (the sample's files)
//
// Uses
//   shared/contract.json (limits.mediaNameMax)
//
// Change impact
//   The rule applies to names already stored: making it stricter doesn't change them, it only
//   refuses such a name when it's next set.
const contract = require('../../shared/contract.json');

const MAX_LENGTH = contract.limits.mediaNameMax;

const CONTROL = /[\u0000-\u001f\u007f]/g;

function cleanName(value) {
  return String(value ?? '').replace(CONTROL, '').trim();
}

// Some browsers send a path with the file name; only the name itself is kept
function nameFromUpload(original) {
  const name = [...cleanName(String(original ?? '').split(/[\\/]/).pop())].slice(0, MAX_LENGTH).join('').trim();
  return name || null;
}

module.exports = { MAX_LENGTH, cleanName, nameFromUpload };
