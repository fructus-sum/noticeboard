const http = require('http');
const configService = require('./services/configService');
const schedulerService = require('./services/schedulerService');
const { syncSampleSlideshow } = require('./services/sampleSlideshow');
const createApp = require('./app');
const { initDisplaySocket } = require('./realtime/displaySocket');
const { createDevFrontends } = require('./utils/devFrontends');
const logger = require('./utils/logger');

async function main() {
  await configService.init();
  // Optional extra: if it fails, log it and start anyway
  await syncSampleSlideshow().catch((err) => logger.error('Could not set up the sample slideshow', { err: err.message }));

  const port = configService.get('port') || 3000;
  // npm run dev fills these in once Vite is ready (see utils/devFrontends.js)
  const frontends = process.env.NOTICEBOARD_DEV === '1' ? {} : null;
  const app = createApp({ frontends });
  const server = http.createServer(app);
  if (frontends) {
    Object.assign(frontends, await createDevFrontends(server));
    logger.info('Development: Vite serves the viewer and the admin panel on this port');
  }

  const io = initDisplaySocket(server);
  schedulerService.init();

  server.listen(port, () => {
    logger.info('Noticeboard server started', { port });
    logger.info(`Display : http://localhost:${port}/`);
    logger.info(`Admin   : http://localhost:${port}/admin`);
  });

  function shutdown() {
    schedulerService.stop();
    // io.close() disconnects the displays too; server.close() alone waits for them indefinitely
    io.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGTERM', () => { logger.info('SIGTERM received, shutting down gracefully'); shutdown(); });
  process.on('SIGINT',  () => { logger.info('SIGINT received, shutting down gracefully');  shutdown(); });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
