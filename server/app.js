const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const mountRoutes = require('./routes/index');
const errorHandler = require('./middleware/errorHandler');

function createApp({ frontends = null } = {}) {
  const app = express();

  app.use(
    helmet({
      // CSP is relaxed for the SPA; tighten in a future hardening pass
      contentSecurityPolicy: false,
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  mountRoutes(app, frontends);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
