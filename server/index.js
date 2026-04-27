const http = require('http');
const configService = require('./services/configService');
const schedulerService = require('./services/schedulerService');
const createApp = require('./app');
const { initSocket } = require('./socket');
const logger = require('./utils/logger');

async function main() {
  await configService.init();

  const port = configService.get('port') || 3000;
  const app = createApp();
  const server = http.createServer(app);

  initSocket(server);
  schedulerService.init();

  server.listen(port, () => {
    logger.info('Noticeboard server started', { port });
    logger.info(`Display : http://localhost:${port}/`);
    logger.info(`Admin   : http://localhost:${port}/admin`);
  });

  function shutdown() {
    schedulerService.stop();
    server.close(() => process.exit(0));
  }

  process.on('SIGTERM', () => { logger.info('SIGTERM received, shutting down gracefully'); shutdown(); });
  process.on('SIGINT',  () => { logger.info('SIGINT received, shutting down gracefully');  shutdown(); });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
