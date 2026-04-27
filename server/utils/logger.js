const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { logsDir } = require('./pathHelpers');

fs.mkdirSync(logsDir(), { recursive: true });

const isProd = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      format: isProd
        ? winston.format.json()
        : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
    new winston.transports.File({
      filename: path.join(logsDir(), 'app.log'),
      format: winston.format.json(),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
