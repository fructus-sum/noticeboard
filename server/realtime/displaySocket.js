// server/realtime/displaySocket.js — the live connection to every display (socket.io)
//
// Responsibilities
//   The only module that uses socket.io. It tells each display the build it should run, its own
//   look (the location pin, the logo) and the playlist, when it connects and whenever they change.
//   The event names are shared with the viewer (shared/contract.json).
//
// Provides
//   initDisplaySocket(httpServer) → the socket.io server. On connect: display:build and
//     display:settings; on display:ready: that display's playlist. Afterwards:
//       playlist:update to all   on the scheduler's 'update' and on displayEvents.playlistChanged
//       display:settings to all  on a config 'change' and on displayEvents.displaySettingsChanged,
//                                only when the settings differ from the last ones sent
//
// Used by
//   server/index.js
//
// Uses
//   socket.io; services/playlistService (buildPlaylist), services/brandingService (displaySettings),
//   services/schedulerService (getActive, 'update'), services/configService ('change'),
//   services/displayEvents, utils/displayBuildId, utils/logger
//
// Change impact
//   /socket.io, the event names and their payloads are a contract with screens already open,
//   which run the old viewer until they reload (OLD_SYSTEM_DESIGN §15). A display reloads when
//   display:build changes.
const { Server } = require('socket.io');
const schedulerService = require('../services/schedulerService');
const configService = require('../services/configService');
const displayEvents = require('../services/displayEvents');
const { buildPlaylist } = require('../services/playlistService');
const { displaySettings } = require('../services/brandingService');
const { displayBuildId } = require('../utils/displayBuildId');
const logger = require('../utils/logger');
const { socketEvents: EVENTS } = require('../../shared/contract.json');

function initDisplaySocket(httpServer) {
  // The displays are always served from this server, so no cross-origin access is needed
  const io = new Server(httpServer);

  // Sent on every connect: a display that sees it change reloads to pick up the new build
  const buildId = displayBuildId();
  let lastSettings = JSON.stringify(displaySettings());

  // The displays' own look: sent again only when it has changed
  function broadcastDisplaySettings() {
    const settings = displaySettings();
    const json = JSON.stringify(settings);
    if (json === lastSettings) return;
    lastSettings = json;
    io.emit(EVENTS.DISPLAY_SETTINGS, settings);
    logger.info('Socket: display:settings broadcast', settings);
  }

  function broadcastPlaylist() {
    const playlist = buildPlaylist(schedulerService.getActive());
    io.emit(EVENTS.PLAYLIST_UPDATE, playlist);
    logger.info('Socket: playlist:update broadcast', { slideCount: playlist.slides.length });
  }

  io.on('connection', (socket) => {
    logger.info('Socket: display connected', { id: socket.id });
    socket.emit(EVENTS.DISPLAY_BUILD, buildId);
    socket.emit(EVENTS.DISPLAY_SETTINGS, displaySettings());

    socket.on(EVENTS.DISPLAY_READY, () => {
      const playlist = buildPlaylist(schedulerService.getActive());
      socket.emit(EVENTS.PLAYLIST_UPDATE, playlist);
      logger.info('Socket: playlist sent to display', { id: socket.id, slideCount: playlist.slides.length });
    });

    socket.on('disconnect', () => {
      logger.info('Socket: display disconnected', { id: socket.id });
    });
  });

  schedulerService.on('update', broadcastPlaylist);
  displayEvents.onPlaylistChanged(broadcastPlaylist);
  configService.on('change', broadcastDisplaySettings);
  displayEvents.onDisplaySettingsChanged(broadcastDisplaySettings);

  logger.info('Socket.io initialised');
  return io;
}

module.exports = { initDisplaySocket };
