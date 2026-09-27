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
//   PROJECT_URL                 the project on GitHub
//   installerCommand(branch)    the one-line command that runs <branch>'s installer on a Pi
//
// Used by
//   client/display (useSocket), client/admin (NavBar, InstallerNotice); server/socket.js reads
//   contract.json directly
//
// Change impact
//   The event names are a contract with screens already open, which run the old viewer until
//   they reload: they must never change (OLD_SYSTEM_DESIGN §15).
import contract from './contract.json';

export const SOCKET_EVENTS = contract.socketEvents;

// The project on GitHub (the installers use the same repository)
export const PROJECT_URL = 'https://github.com/fructus-sum/noticeboard';

// The command that runs <branch>'s installer on a Pi (in a terminal on it, or over SSH)
export function installerCommand(branch = 'main') {
  return `curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/${branch}/installers/install.sh | sudo bash`;
}
