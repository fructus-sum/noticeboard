const express = require('express');
const path = require('path');
const macFilter = require('../middleware/macFilter');
const adminAuth = require('../middleware/adminAuth');
const displayRouter = require('./display');
const adminRouter = require('./admin');
const { ROOT, slideshowsDir } = require('../utils/pathHelpers');

const DISPLAY_DIST = path.join(ROOT, 'client', 'display', 'dist');
const ADMIN_DIST = path.join(ROOT, 'client', 'admin', 'dist');

function mountRoutes(app) {
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

  // 2. Admin static assets — MAC + adminAuth (Vite builds with base '/admin/')
  app.use('/admin', adminAuth, express.static(ADMIN_DIST));

  // 3. Admin SPA — serves index.html for all /admin/* Vue Router routes
  app.use('/admin', adminAuth, adminRouter);

  // 4. API routes (added in Session 2)
  // app.use('/api', require('./api'));

  // 5. Display static assets — MAC filtered
  app.use('/', macFilter, express.static(DISPLAY_DIST));

  // 6. Display SPA catch-all — MAC filtered
  app.use('/', macFilter, displayRouter);
}

module.exports = mountRoutes;
