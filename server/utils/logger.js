// server/utils/logger.js — the server's log (winston)
//
// Provides
//   logger.error / warn / info / debug(message, details)
//   Written as JSON lines to the console (on a Pi: the journal, journalctl -u noticeboard) and to
//   logs/app.log (5 MB, 3 files kept).
//
// Environment
//   NOTICEBOARD_LOG_LEVEL=debug   also writes the debug lines (e.g. each MAC lookup), for
//                                 troubleshooting; anything else, or unset, gives info and above
//
// Used by: all server modules (never console.log)
// Uses: winston, utils/pathHelpers (logsDir)
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { logsDir } = require('./pathHelpers');

fs.mkdirSync(logsDir(), { recursive: true });

const logger = winston.createLogger({
  level: process.env.NOTICEBOARD_LOG_LEVEL === 'debug' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.json() }),
    new winston.transports.File({
      filename: path.join(logsDir(), 'app.log'),
      format: winston.format.json(),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
