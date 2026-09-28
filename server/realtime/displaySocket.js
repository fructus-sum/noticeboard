// server/realtime/displaySocket.js — the live connection to every display (socket.io)
//
// Responsibilities
//   The only module that uses socket.io. Only approved devices may connect: MAC filtering applies
//   here as it does to the pages (a device it blocks gets a connect error and nothing else), and
//   when the approved list or the switch changes, connections no longer approved are closed.
//   It tells each display the build it should run, its own
//   look (the location pin, the logo), the playlist and the background audio, when it connects and
//   whenever they change.
//   The event names are shared with the viewer (shared/contract.json).
//
// Provides
//   initDisplaySocket(httpServer) → the socket.io server. On connect: display:build and
//     display:settings; on display:ready: that display's playlist, then the audio. Afterwards:
//       playlist:update to all   on the scheduler's 'update' and on displayEvents.playlistChanged
//       display:settings to all  on a config 'change', on displayEvents.displaySettingsChanged,
//                                and when the installer state changes (checked when a display
//                                connects and every 5 minutes), only when the settings differ
//                                from the last ones sent
//       audio:update to all      on a config 'change', on displayEvents.audioChanged and on the
//                                event clock's 'update', only when it differs from the last one
//                                sent (SYSTEM_DESIGN §18.3)
//
// Used by
//   server/index.js
//
// Uses
//   socket.io; services/macService (resolveAddress: who may connect), services/playlistService
//   (buildPlaylist), services/audioPlaylist (buildAudio),
//   services/audioEventClock (the event playing, 'update'),
//   services/displaySettings (the payload),
//   services/schedulerService (getActive, 'update'), services/configService ('change'),
//   services/displayEvents, utils/displayBuildId, utils/logger
//
// Change impact
//   /socket.io, the event names and their payloads are a contract with screens already open,
//   which run the old viewer until they reload (SYSTEM_DESIGN §15). A display reloads when
//   display:build changes.
const { Server } = require('socket.io');
const schedulerService = require('../services/schedulerService');
const configService = require('../services/configService');
const displayEvents = require('../services/displayEvents');
const { buildPlaylist } = require('../services/playlistService');
const { buildAudio } = require('../services/audioPlaylist');
const audioEventClock = require('../services/audioEventClock');
const displaySettings = require('../services/displaySettings');
const macService = require('../services/macService');
const { displayBuildId } = require('../utils/displayBuildId');
const logger = require('../utils/logger');
const { socketEvents: EVENTS } = require('../../shared/contract.json');

function initDisplaySocket(httpServer) {
  // The displays are always served from this server, so no cross-origin access is needed
  const io = new Server(httpServer);

  // MAC filtering, as for the pages (middleware/access.js): an unapproved device, or one that
  // can't be identified, isn't let in
  const approved = async (address) => {
    try {
      return (await macService.resolveAddress(address)).approved;
    } catch (err) {
      logger.error('Socket: MAC check error', { err: err.message });
      return false;
    }
  };
  io.use((socket, next) => {
    approved(socket.handshake.address).then((ok) => {
      if (ok) return next();
      logger.warn('Display: MAC denied (socket)', { ip: socket.handshake.address });
      next(new Error('Not Found'));
    });
  });
  // A change to MAC filtering: close the connections it no longer allows
  let lastFiltering = JSON.stringify(configService.get('macFiltering'));
  configService.on('change', async () => {
    const now = JSON.stringify(configService.get('macFiltering'));
    if (now === lastFiltering) return;
    lastFiltering = now;
    for (const socket of io.of('/').sockets.values()) {
      if (!(await approved(socket.handshake.address))) {
        logger.warn('Display: MAC no longer approved, disconnected', { ip: socket.handshake.address });
        socket.disconnect(true);
      }
    }
  });

  // Sent on every connect: a display that sees it change reloads to pick up the new build
  const buildId = displayBuildId();
  let lastSettings = JSON.stringify(displaySettings.current());

  // The displays' own look and state: sent again only when it has changed
  function broadcastDisplaySettings() {
    const settings = displaySettings.current();
    const json = JSON.stringify(settings);
    if (json === lastSettings) return;
    lastSettings = json;
    io.emit(EVENTS.DISPLAY_SETTINGS, settings);
    logger.info('Socket: display:settings broadcast', settings);
  }

  // The background audio: sent again only when it has changed
  const currentAudio = () => buildAudio({ event: audioEventClock.getActive() });
  let lastAudio = JSON.stringify(currentAudio());
  function broadcastAudio() {
    const audio = currentAudio();
    const json = JSON.stringify(audio);
    if (json === lastAudio) return;
    lastAudio = json;
    io.emit(EVENTS.AUDIO_UPDATE, audio);
    logger.info('Socket: audio:update broadcast', { shows: Object.keys(audio.shows).length, slideshows: Object.keys(audio.slideshows).length });
  }

  function broadcastPlaylist() {
    const playlist = buildPlaylist(schedulerService.getActive());
    io.emit(EVENTS.PLAYLIST_UPDATE, playlist);
    logger.info('Socket: playlist:update broadcast', { slideCount: playlist.slides.length });
  }

  const INSTALLER_CHECK_MS = 5 * 60 * 1000;
  displaySettings.refresh().then(broadcastDisplaySettings);
  setInterval(() => displaySettings.refresh().then(broadcastDisplaySettings), INSTALLER_CHECK_MS).unref();

  io.on('connection', (socket) => {
    logger.info('Socket: display connected', { id: socket.id });
    socket.emit(EVENTS.DISPLAY_BUILD, buildId);
    socket.emit(EVENTS.DISPLAY_SETTINGS, displaySettings.current());
    // The installer state is read from files: check it again, and tell everyone if it changed
    displaySettings.refresh().then(broadcastDisplaySettings);

    socket.on(EVENTS.DISPLAY_READY, () => {
      const playlist = buildPlaylist(schedulerService.getActive());
      socket.emit(EVENTS.PLAYLIST_UPDATE, playlist);
      logger.info('Socket: playlist sent to display', { id: socket.id, slideCount: playlist.slides.length });
      socket.emit(EVENTS.AUDIO_UPDATE, currentAudio());
    });

    socket.on('disconnect', () => {
      logger.info('Socket: display disconnected', { id: socket.id });
    });
  });

  schedulerService.on('update', broadcastPlaylist);
  displayEvents.onPlaylistChanged(broadcastPlaylist);
  configService.on('change', broadcastDisplaySettings);
  displayEvents.onDisplaySettingsChanged(broadcastDisplaySettings);
  configService.on('change', broadcastAudio);
  displayEvents.onAudioChanged(broadcastAudio);
  audioEventClock.on('update', broadcastAudio);

  logger.info('Socket.io initialised');
  return io;
}

module.exports = { initDisplaySocket };
