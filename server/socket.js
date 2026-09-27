const { Server } = require('socket.io');
const schedulerService = require('./services/schedulerService');
const configService = require('./services/configService');
const store = require('./services/slideshowStore');
const { mediaUrl } = require('./utils/pathHelpers');
const logger = require('./utils/logger');
const { displayBuildId } = require('./utils/displayBuildId');
const { displaySettings } = require('./services/brandingService');
// The event names are shared with the viewer (shared/contract.json)
const { socketEvents: EVENTS } = require('../shared/contract.json');

function buildPlaylist(activeSlideshows) {
  const defaultDuration = configService.get('display')?.defaultSlideDurationSeconds ?? 10;
  const slides = [];

  for (const active of activeSlideshows) {
    // The scheduler lists which slideshows are on; their settings (e.g. a duration changed
    // while they're on air) come from config.json as it is now
    const ss = store.find(active.folder) || active;
    for (const slide of store.readSlides(ss.folder).slides.filter((s) => s.status === 'ready')) {
      slides.push({
        type: slide.type,
        url: mediaUrl(ss.folder, slide.filename),
        // Images: the slide's own time if it has one, else its slideshow's, else the default.
        // Each slide carries its own, so a slideshow's last slide keeps its slideshow's time.
        duration: slide.type === 'image' ? (slide.duration ?? ss.slideDurationSeconds ?? defaultDuration) : null,
        slideshow: ss.folder,
      });
    }
  }

  return { slides };
}

let io;
let lastSettings = '';

// The displays' own look (the location pin, the logo): sent on connect, and again whenever
// the settings change
function broadcastDisplaySettings() {
  if (!io) return;
  const settings = displaySettings();
  const json = JSON.stringify(settings);
  if (json === lastSettings) return;
  lastSettings = json;
  io.emit(EVENTS.DISPLAY_SETTINGS, settings);
  logger.info('Socket: display:settings broadcast', settings);
}

function broadcastPlaylist() {
  if (!io) return;
  const playlist = buildPlaylist(schedulerService.getActive());
  io.emit(EVENTS.PLAYLIST_UPDATE, playlist);
  logger.info('Socket: playlist:update broadcast', { slideCount: playlist.slides.length });
}

function initSocket(server) {
  // The displays are always served from this server, so no cross-origin access is needed.
  // In development, Vite's hot-reload connections share the port: leave those to Vite.
  io = new Server(server, { destroyUpgrade: process.env.NOTICEBOARD_DEV !== '1' });

  // Sent on every connect: a display that sees it change reloads to pick up the new build
  const buildId = displayBuildId();

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
  lastSettings = JSON.stringify(displaySettings());
  configService.on('change', broadcastDisplaySettings);

  logger.info('Socket.io initialised');
  return io;
}

module.exports = { initSocket, buildPlaylist, broadcastPlaylist, broadcastDisplaySettings };
