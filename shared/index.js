// shared/index.js — what the viewer and the admin panel share (imported as @shared/index.js)
//
// Responsibilities
//   Constants and small helpers both web apps need. Values the server must agree with live in
//   contract.json, which the server reads too. PUBLIC VALUES ONLY: everything imported from here
//   is built into the JavaScript every browser downloads, and the repository is public. Never put
//   secrets, Pi file paths or anything from data/ here.
//
// Provides
//   SOCKET_EVENTS               the socket.io event names (from contract.json)
//   LIMITS                      limits the server checks too (from contract.json): the image
//                               duration in seconds { min, max }, the admin password's minimum
//                               length, the longest media name
//   DEFAULT_BACKGROUND          the viewer's background colour until one is chosen (from contract.json)
//   isColour(value)             a colour code the server accepts: # and six hex digits (the pattern
//                               is in contract.json, which the server checks with too)
//   VIDEO_FORMATS, DEFAULT_VIDEO_FORMAT  what uploaded videos can be converted to (h265, h264)
//                               and the default (from contract.json, which the server checks with too)
//   AUDIO                       what an audio show's settings may be (from contract.json, which the
//                               server checks with too): orders, transitions, fadeSeconds, volume
//   audioUrl(folder, file)      the URL of an audio show's track; the server's pathHelpers.audioUrl
//                               makes the same (server/test/foundations.test.js)
//   PROJECT_URL                 the project on GitHub
//   installerCommand(branch)    the one-line command that runs <branch>'s installer on a Pi
//   mediaUrl(folder, file)      the URL of a slide's file (or its thumbnail); the server's
//                               pathHelpers.mediaUrl makes the same (server/test/foundations.test.js)
//   mediaDisplayName(item)      what the admin panel calls a slide (and later an audio track): its
//                               own name, else the uploaded file's name, else its type and the date
//                               it was added, e.g. "Image, added 12 Mar 2026, 14:02" (SYSTEM_DESIGN
//                               §14 D38)
//
// Used by
//   client/display (useSocket), client/admin (NavBar, InstallerNotice, the slideshow page and its
//   slide list and preview, the Settings cards); the server reads contract.json directly (realtime/displaySocket,
//   adminPassword, slideshowRules, settingsService, brandingService)
//
// Change impact
//   The event names are a contract with screens already open, which run the old viewer until
//   they reload: they must never change (SYSTEM_DESIGN §15). The /media URLs are served by
//   the server and used in open admin pages.
import contract from './contract.json';

export const SOCKET_EVENTS = contract.socketEvents;
export const LIMITS = contract.limits;
export const DEFAULT_BACKGROUND = contract.display.defaultBackground;
export const VIDEO_FORMATS = contract.display.videoFormats;
export const DEFAULT_VIDEO_FORMAT = contract.display.defaultVideoFormat;
export const AUDIO = contract.audio;

const COLOUR = new RegExp(contract.display.colourPattern);
export const isColour = (value) => typeof value === 'string' && COLOUR.test(value);

// The project on GitHub (the installers use the same repository)
export const PROJECT_URL = 'https://github.com/fructus-sum/noticeboard';

// The command that runs <branch>'s installer on a Pi (in a terminal on it, or over SSH)
export function installerCommand(branch = 'main') {
  return `curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/${branch}/installers/install.sh | sudo bash`;
}

// An audio show's track as the server serves it
export function audioUrl(folder, file) {
  return `/audio/${folder}/tracks/${file}`;
}

// A slide's file (or its video's thumbnail) as the server serves it
export function mediaUrl(folder, file) {
  return `/media/${folder}/slides/${file}`;
}

// What the admin panel calls an uploaded item. Items from before names existed have neither name,
// so they're described by their type and when they were added, in the browser's own date format.
export function mediaDisplayName(item) {
  const own = item?.name || item?.originalName;
  if (own) return own;
  const type = item?.type ? item.type[0].toUpperCase() + item.type.slice(1) : 'File';
  const added = item?.addedAt ? new Date(item.addedAt) : null;
  if (!added || Number.isNaN(added.getTime())) return type;
  const when = added.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${type}, added ${when}`;
}
