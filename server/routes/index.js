// server/routes/index.js — every URL the server answers, mounted in order
//
// The order matters (SYSTEM_DESIGN §3.3): media, the user guide and the logo come before
// the admin panel's catch-all; the API before the viewer's catch-all at /. Everything except
// /api/auth, /api/device and the admin API is behind the MAC filter here; the API sets its own
// guards (routes/api/index.js).
//
// Provides
//   mountRoutes(app): /media, /admin/help (the guide), /branding/logo, the admin panel (/admin),
//   the API (/api), the viewer (/); the two apps are their built copies, or a "not built" page
//
// Used by
//   server/app.js
//
// Change impact
//   The URLs are a contract with kiosk scripts, help shortcuts and open browser tabs: they must
//   not change (SYSTEM_DESIGN §15).
const express = require('express');
const path = require('path');
const macFilter = require('../middleware/macFilter');
const { route } = require('../middleware/asyncRoute');
const { spaFallback } = require('./spa');
const { slideshowsDir, guidePath, logoPath, displayDistDir, adminDistDir } = require('../utils/pathHelpers');
const { hasCustomLogo, placeholderLogo } = require('../services/brandingService');
const { SERVED_EXTENSIONS } = require('../services/mediaTypes');

const DISPLAY_DIST = displayDistDir();
const ADMIN_DIST = adminDistDir();
const displayRouter = spaFallback(DISPLAY_DIST, { title: 'Noticeboard Display', background: '#000', name: 'Display' });
const adminRouter = spaFallback(ADMIN_DIST, { title: 'Noticeboard Admin', background: '#1a1a2e', name: 'Admin' });

// The two web apps are always their built copies (client/*/dist, made by npm run build)
function mountRoutes(app) {
  // 1. Media files: images, videos, audio — MAC filtered, streaming-capable
  app.use(
    '/media',
    macFilter,
    (req, res, next) => {
      // Only serve known media extensions; block direct access to .json config files
      const ext = path.extname(req.path).toLowerCase();
      if (!SERVED_EXTENSIONS.includes(ext)) return res.status(404).send('Not Found');
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
  app.get('/branding/logo', macFilter, route(async (req, res) => {
    res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (hasCustomLogo()) return res.type('png').sendFile(logoPath());
    res.type('png').send(await placeholderLogo());
  }));

  // 2. Admin static assets — MAC filtered; JWT is not required to download the SPA shell
  app.use('/admin', macFilter, express.static(ADMIN_DIST));

  // 3. Admin SPA — serves index.html for all /admin/* Vue Router routes
  app.use('/admin', macFilter, adminRouter);

  // 4. API routes
  app.use('/api', require('./api'));

  // 5. Display static assets — MAC filtered
  app.use('/', macFilter, express.static(DISPLAY_DIST));

  // 6. Display SPA catch-all — MAC filtered
  app.use('/', macFilter, displayRouter);
}

module.exports = mountRoutes;
