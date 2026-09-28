// server/index.js — the server process: start-up in order, listening, graceful shutdown
//
// Responsibilities
//   A pending Restore Defaults (contentReset.applyPendingRestore) → configService.init → an
//   unfinished video conversion tidied up → the sample slideshow sync (an error is logged, start-up carries on) → the Express app → the display socket → the scheduler → the event audio clock → listen on config.port (3000 if unset).
//   SIGTERM or SIGINT stops the scheduler and the event audio clock, and closes the sockets (forced exit after 5 s).
//
// Used by
//   systemd (noticeboard.service runs node server/index.js), npm start, update.sh (restarts it),
//   the test harnesses
//
// Uses
//   services/contentReset, services/videoConversion (recover), services/configService, services/sampleSlideshow, app.js, realtime/displaySocket,
//   services/schedulerService, services/audioEventClock, utils/logger
//
// Change impact
//   The path server/index.js is in every installed service unit (SYSTEM_DESIGN §15). The
//   order matters: the socket must exist before the scheduler and the event clock first announce (§3.2).
const http = require('http');
const { applyPendingRestore } = require('./services/contentReset');
const videoConversion = require('./services/videoConversion');
const configService = require('./services/configService');
const schedulerService = require('./services/schedulerService');
const { syncSampleSlideshow } = require('./services/sampleSlideshow');
const createApp = require('./app');
const { initDisplaySocket } = require('./realtime/displaySocket');
const audioEventClock = require('./services/audioEventClock');
const logger = require('./utils/logger');

async function main() {
  // Restore Defaults asked for (SYSTEM_DESIGN §14 D42): reset the data before anything reads it
  applyPendingRestore();
  await configService.init();
  // A video conversion the server didn't finish: those videos keep their old files
  await videoConversion.recover().catch((err) => logger.error('Could not tidy up an unfinished video conversion', { err: err.message }));
  // Optional extra: if it fails, log it and start anyway
  await syncSampleSlideshow().catch((err) => logger.error('Could not set up the sample slideshow', { err: err.message }));

  const port = configService.get('port') || 3000;
  const app = createApp();
  const server = http.createServer(app);

  const io = initDisplaySocket(server);
  schedulerService.init();
  audioEventClock.init();

  server.listen(port, () => {
    logger.info('Noticeboard server started', { port });
    logger.info(`Display : http://localhost:${port}/`);
    logger.info(`Admin   : http://localhost:${port}/admin`);
  });

  function shutdown() {
    schedulerService.stop();
    audioEventClock.stop();
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
