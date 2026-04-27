const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
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

  if (process.env.NODE_ENV !== 'production') {
    app.use(
      cors({
        // Vite dev servers for both SPAs
        origin: [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
        ],
        credentials: true,
      })
    );
  }

  mountRoutes(app);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
