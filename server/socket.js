const { Server } = require('socket.io');
const fs = require('fs');
const schedulerService = require('./services/schedulerService');
const configService = require('./services/configService');
const { slideshowJsonPath, mediaUrl, watermarkUrl } = require('./utils/pathHelpers');
const logger = require('./utils/logger');

const DEV_ORIGINS = [
  'http://localhost:3000',   // production build served by Express
  'http://localhost:5173',   // display Vite dev server
  'http://localhost:5174',   // admin Vite dev server
  'http://localhost:5175',
];

function buildPlaylist(activeSlideshows) {
  const defaultDuration = configService.get('display')?.defaultSlideDurationSeconds ?? 10;
  const slides = [];

  for (const ss of activeSlideshows) {
    let data = { slides: [] };
    try {
      data = JSON.parse(fs.readFileSync(slideshowJsonPath(ss.folder), 'utf8'));
    } catch {
      // empty or missing slideshow.json — skip
    }
    const wm = ss.watermark;
    for (const slide of data.slides.filter(s => s.status === 'ready')) {
      let watermark = null;
      if (wm?.filename) {
        const showByDefault = wm.showOnAllSlides !== false;
        const slideOverride = slide.watermarkEnabled;
        const show = slideOverride === true || (showByDefault && slideOverride !== false);
        if (show) {
          watermark = {
            url:      watermarkUrl(ss.folder, wm.filename),
            position: wm.position ?? 'bottom-right',
            size:     wm.size ?? 10,
            opacity:  wm.opacity ?? 0.85,
          };
        }
      }
      slides.push({
        type:      slide.type,
        url:       slide.type !== 'text' ? mediaUrl(ss.folder, slide.filename) : null,
        duration:  slide.type !== 'video' ? (slide.duration ?? defaultDuration) : null,
        slideshow: ss.folder,
        overlay:   slide.overlay ?? null,
        bgColor:   slide.bgColor ?? null,
        watermark,
      });
    }
  }

  return { slides };
}

let io;

function broadcastPlaylist() {
  if (!io) return;
  const playlist = buildPlaylist(schedulerService.getActive());
  io.emit('playlist:update', playlist);
  logger.info('Socket: playlist:update broadcast', { slideCount: playlist.slides.length });
}

function initSocket(server) {
  io = new Server(server, {
    cors: process.env.NODE_ENV !== 'production'
      ? { origin: DEV_ORIGINS, credentials: true }
      : undefined,
  });

  io.on('connection', (socket) => {
    logger.info('Socket: display connected', { id: socket.id });

    socket.on('display:ready', () => {
      const playlist = buildPlaylist(schedulerService.getActive());
      socket.emit('playlist:update', playlist);
      logger.info('Socket: playlist sent to display', { id: socket.id, slideCount: playlist.slides.length });
    });

    socket.on('disconnect', () => {
      logger.info('Socket: display disconnected', { id: socket.id });
    });
  });

  schedulerService.on('update', broadcastPlaylist);

  logger.info('Socket.io initialised');
  return io;
}

module.exports = { initSocket, buildPlaylist, broadcastPlaylist };
