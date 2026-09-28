// server/services/displayEvents.js — "the displays need to hear about this"
//
// Responsibilities
//   The explicit channel from the rest of the server to the connected displays. Routes and
//   services announce a change here; realtime/displaySocket.js listens and tells the displays.
//   So nothing but the socket module depends on socket.io, and nothing needs to fake a config
//   change to reach the displays.
//
// Provides
//   playlistChanged()                what is on air may have changed (a slide added, removed or
//                                    reordered, a slideshow changed): send the playlist again.
//                                    Displays ignore a playlist that hasn't changed
//   displaySettingsChanged()         the displays' own look may have changed (the logo): send
//                                    the display settings again (only if they differ)
//   onPlaylistChanged(fn), onDisplaySettingsChanged(fn)   for realtime/displaySocket.js
//
// Used by
//   routes/api/slideshows.js, routes/api/slides.js, routes/api/settings/logo.js (logo),
//   services/uploadQueue.js, services/contentReset.js (Delete All); realtime/displaySocket.js listens
//
// Change impact
//   An announcement before the socket exists (e.g. during start-up) reaches nobody, which is
//   fine: displays get everything when they connect.
const EventEmitter = require('events');

const events = new EventEmitter();

module.exports = {
  playlistChanged: () => events.emit('playlist'),
  displaySettingsChanged: () => events.emit('settings'),
  onPlaylistChanged: (fn) => events.on('playlist', fn),
  onDisplaySettingsChanged: (fn) => events.on('settings', fn),
};
