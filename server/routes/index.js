const express = require('express');
const path = require('path');
const macFilter = require('../middleware/macFilter');
const adminAuth = require('../middleware/adminAuth');
const displayRouter = require('./display');
const adminRouter = require('./admin');
const { ROOT, slideshowsDir, guidePath, logoPath } = require('../utils/pathHelpers');
const { hasCustomLogo, placeholderLogo } = require('../services/brandingService');

const DISPLAY_DIST = path.join(ROOT, 'client', 'display', 'dist');
const ADMIN_DIST = path.join(ROOT, 'client', 'admin', 'dist');

// `frontends` is only set by npm run dev: Vite then serves the two web apps (with hot reload)
// instead of their built copies, on this same port
function mountRoutes(app, frontends = null) {
  const notReady = (res) => res.status(503).send('Starting…');
  // 1. Media files: images, videos, audio — MAC filtered, streaming-capable
  app.use(
    '/media',
    macFilter,
    (req, res, next) => {
      // Only serve known media extensions; block direct access to .json config files
      const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.wav', '.ogg'];
      const ext = path.extname(req.path).toLowerCase();
      if (!allowed.includes(ext)) return res.status(404).send('Not Found');
      res.setHeader('Accept-Ranges', 'bytes');
      next();
    },
    express.static(slideshowsDir())
  );

  // User guide, opened from the admin sidebar's Help link — MAC filtered like the admin
  // panel. It must come before the admin SPA catch-all below.
  app.get('/admin/help', macFilter, (req, res) => {
    res.sendFile(guidePath(), (err) => {
      if (err && !res.headersSent) res.status(404).send('User guide not found');
    });
  });

  // The logo, for the displays and the admin sidebar — MAC filtered like the display.
  // Its URL carries a version, so it can be cached for good.
  app.get('/branding/logo', macFilter, async (req, res, next) => {
    try {
      res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (hasCustomLogo()) return res.type('png').sendFile(logoPath());
      res.type('png').send(await placeholderLogo());
    } catch (err) {
      next(err);
    }
  });

  if (frontends) {
    // 2–3 (development). Vite expects the full /admin/… path, so this isn't mounted at /admin
    app.use((req, res, next) => {
      if (req.path !== '/admin' && !req.path.startsWith('/admin/')) return next();
      macFilter(req, res, () => (frontends.admin ? frontends.admin(req, res, next) : notReady(res)));
    });
  } else {
    // 2. Admin static assets — MAC filtered; JWT is not required to download the SPA shell
    app.use('/admin', macFilter, express.static(ADMIN_DIST));

    // 3. Admin SPA — serves index.html for all /admin/* Vue Router routes
    app.use('/admin', macFilter, adminRouter);
  }

  // 4. API routes
  app.use('/api', require('./api'));

  if (frontends) {
    // 5–6 (development)
    app.use('/', macFilter, (req, res, next) => (frontends.display ? frontends.display(req, res, next) : notReady(res)));
  } else {
    // 5. Display static assets — MAC filtered
    app.use('/', macFilter, express.static(DISPLAY_DIST));

    // 6. Display SPA catch-all — MAC filtered
    app.use('/', macFilter, displayRouter);
  }
}

module.exports = mountRoutes;
