// server/services/restartState.js — settings that only take effect when the Server restarts
//
// Responsibilities
//   Some settings are read once, at start-up (today only the port: the Server listens on it). This
//   module knows what the Server is running with, says when the saved settings differ (the admin
//   panel's "Restart the Server" box and the screens' warning mark), and restarts the Server when
//   asked: it ends the process gracefully and systemd starts it again, since the service has
//   Restart=always (SYSTEM_DESIGN §18.5 item 4). Started any other way (e.g. by hand), it just stops.
//
// Provides
//   setRunning({ port })      at start-up: what the Server is running with
//   status()                  → { restartNeeded, port: { running, saved } }
//   requestRestart(by)        ends the process shortly after (so the answer gets out first), with
//                             the same graceful shutdown as SIGTERM
//
// Used by
//   server/index.js (setRunning), routes/api/settings/maintenance.js (status, requestRestart),
//   services/displaySettings (restartNeeded for the screens)
//
// Uses
//   services/configService (the saved port), utils/logger
const configService = require('./configService');
const logger = require('../utils/logger');

const DEFAULT_PORT = 3000;
let running = null;

function setRunning({ port }) {
  running = { port };
}

function status() {
  const saved = configService.get('port') || DEFAULT_PORT;
  const runningPort = running?.port ?? saved;
  return { restartNeeded: saved !== runningPort, port: { running: runningPort, saved } };
}

function requestRestart(by) {
  logger.warn('Restart requested from the admin panel', { by, ...status().port });
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500).unref();
}

module.exports = { setRunning, status, requestRestart };
