// server/app.js — the Express app
//
// Provides
//   createApp() → the app: helmet (no CSP), JSON bodies up to 10 MB, cookies, every route
//   (routes/index.js), then middleware/errorHandler
//
// Used by
//   server/index.js, which serves it and the display socket on one HTTP server
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const mountRoutes = require('./routes/index');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(
    helmet({
      // CSP is relaxed for the SPA; tighten in a future hardening pass
      contentSecurityPolicy: false,
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  mountRoutes(app);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
