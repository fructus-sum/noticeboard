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
//                               duration in seconds { min, max }, the admin password's minimum length
//   DEFAULT_BACKGROUND          the viewer's background colour until one is chosen (from contract.json)
//   isColour(value)             a colour code the server accepts: # and six hex digits (the pattern
//                               is in contract.json, which the server checks with too)
//   PROJECT_URL                 the project on GitHub
//   installerCommand(branch)    the one-line command that runs <branch>'s installer on a Pi
//   mediaUrl(folder, file)      the URL of a slide's file (or its thumbnail); the server's
//                               pathHelpers.mediaUrl makes the same (server/test/foundations.test.js)
//
// Used by
//   client/display (useSocket), client/admin (NavBar, InstallerNotice, the slideshow page, the
//   Settings cards); the server reads contract.json directly (realtime/displaySocket,
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

const COLOUR = new RegExp(contract.display.colourPattern);
export const isColour = (value) => typeof value === 'string' && COLOUR.test(value);

// The project on GitHub (the installers use the same repository)
export const PROJECT_URL = 'https://github.com/fructus-sum/noticeboard';

// The command that runs <branch>'s installer on a Pi (in a terminal on it, or over SSH)
export function installerCommand(branch = 'main') {
  return `curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/${branch}/installers/install.sh | sudo bash`;
}

// A slide's file (or its video's thumbnail) as the server serves it
export function mediaUrl(folder, file) {
  return `/media/${folder}/slides/${file}`;
}
