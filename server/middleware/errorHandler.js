// server/middleware/errorHandler.js — the last stop for an error no route handled
//
// Logs it with its details, and answers only "Internal server error" (as JSON for the API), so
// no internal message reaches a browser. Routes that mean to tell the user something answer
// themselves (asyncRoute's jsonRoute).
//
// Used by: app.js (after all routes)
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', {
    err: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  const status = err.status || err.statusCode || 500;
  const message = 'Internal server error';

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).send(message);
}

module.exports = errorHandler;
