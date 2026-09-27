const express = require('express');
const rateLimit = require('express-rate-limit');
const macFilter = require('../../middleware/macFilter');
const adminAuth = require('../../middleware/adminAuth');
const authRouter = require('./auth');
const deviceRouter = require('./device');
const settingsRouter = require('./settings');
const slideshowsRouter = require('./slideshows');
const slidesRouter = require('./slides');

const router = express.Router();

router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
}));

// Auth: MAC filter only — no JWT required to log in or check status
router.use('/auth', macFilter, authRouter);

// Display info pop-up: MAC filter only, like the display itself
router.use('/device', macFilter, deviceRouter);

// Protected: MAC + JWT. The slides routes sit inside the slideshows API, so each request is
// checked once (mounted side by side, a slide request was checked twice).
router.use('/settings', adminAuth, settingsRouter);
const slideshowsApi = express.Router();
slideshowsApi.use('/:folder/slides', slidesRouter);
slideshowsApi.use('/', slideshowsRouter);
router.use('/slideshows', adminAuth, slideshowsApi);

module.exports = router;
