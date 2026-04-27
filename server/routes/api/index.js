const express = require('express');
const rateLimit = require('express-rate-limit');
const macFilter = require('../../middleware/macFilter');
const adminAuth = require('../../middleware/adminAuth');
const authRouter = require('./auth');
const settingsRouter = require('./settings');
const slideshowsRouter = require('./slideshows');

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

// Protected: MAC + JWT
router.use('/settings', adminAuth, settingsRouter);
router.use('/slideshows', adminAuth, slideshowsRouter);

module.exports = router;
