const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', {
    err: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).send(message);
}

module.exports = errorHandler;
