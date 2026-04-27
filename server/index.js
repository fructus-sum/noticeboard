const http = require('http');
const configService = require('./services/configService');
const createApp = require('./app');
const logger = require('./utils/logger');

async function main() {
  await configService.init();

  const port = configService.get('port') || 3000;
  const app = createApp();
  const server = http.createServer(app);

  // Socket.io is wired up in Session 2; placeholder kept here for clarity
  // const { initSocket } = require('./socket');
  // initSocket(server);

  server.listen(port, () => {
    logger.info('Noticeboard server started', { port });
    logger.info(`Display : http://localhost:${port}/`);
    logger.info(`Admin   : http://localhost:${port}/admin`);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
