// server/routes/api/index.js — the /api router: a rate limit, then each API behind its guard
//
// Responsibilities
//   At most 120 requests a minute per IP for everything under /api, then:
//     /auth, /device    the MAC filter only (logging in; the location pin and the kiosk exit)
//     /client           the MAC filter only (a Client only's updates, SYSTEM_DESIGN §18.7 phase 3)
//     /settings         adminAuth
//     /slideshows       adminAuth, once: the slides API is mounted inside it (…/:folder/slides)
//
// Used by
//   routes/index.js
//
// Uses
//   express-rate-limit, middleware/macFilter (auth, device, client), middleware/adminAuth (the rest), and
//   the routers: auth, device, client, settings, slideshows, slides, audioshows, tracks
//
// Change impact
//   The URLs, status codes and JSON shapes are a contract with open admin panels, the kiosk scripts
//   and update.sh's health check (SYSTEM_DESIGN §4.1, §15).
const express = require('express');
const rateLimit = require('express-rate-limit');
const macFilter = require('../../middleware/macFilter');
const adminAuth = require('../../middleware/adminAuth');
const authRouter = require('./auth');
const deviceRouter = require('./device');
const clientRouter = require('./client');
const settingsRouter = require('./settings');
const slideshowsRouter = require('./slideshows');
const slidesRouter = require('./slides');
const audioShowsRouter = require('./audioshows');
const tracksRouter = require('./tracks');

const router = express.Router();

router.use(rateLimit({
  windowMs: 60 * 1000,
  // 120 requests a minute per address; NOTICEBOARD_API_RATE_LIMIT is for tests only (one that
  // clicks through the admin panel much faster than a person can)
  max: Number(process.env.NOTICEBOARD_API_RATE_LIMIT) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
}));

// Auth: MAC filter only — no JWT required to log in or check status
router.use('/auth', macFilter, authRouter);

// Display info pop-up: MAC filter only, like the display itself
router.use('/device', macFilter, deviceRouter);

// A Client only updating itself from its Server: MAC filter only, like the viewer it shows
router.use('/client', macFilter, clientRouter);

// Protected: MAC + JWT. The slides routes sit inside the slideshows API, so each request is
// checked once (mounted side by side, a slide request was checked twice).
router.use('/settings', adminAuth, settingsRouter);
const slideshowsApi = express.Router();
slideshowsApi.use('/:folder/slides', slidesRouter);
slideshowsApi.use('/', slideshowsRouter);
router.use('/slideshows', adminAuth, slideshowsApi);
// The audio shows, with their tracks inside, the same way
const audioShowsApi = express.Router();
audioShowsApi.use('/:folder/tracks', tracksRouter);
audioShowsApi.use('/', audioShowsRouter);
router.use('/audioshows', adminAuth, audioShowsApi);

module.exports = router;
