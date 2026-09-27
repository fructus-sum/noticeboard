// /api/auth: logging in and out, and whether this browser is logged in. Only the MAC filter
// applies here (api/index.js); the session itself is services/adminSession.js, the password
// services/adminPassword.js.
const express = require('express');
const rateLimit = require('express-rate-limit');
const adminPassword = require('../../services/adminPassword');
const adminSession = require('../../services/adminSession');
const { route } = require('../../middleware/asyncRoute');
const logger = require('../../utils/logger');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
});

router.post('/login', loginLimiter, route(async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  if (!(await adminPassword.verify(password))) {
    logger.warn('Admin login failed', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid password' });
  }

  adminSession.issue(res);
  logger.info('Admin login success', { ip: req.ip });
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  adminSession.clear(res);
  res.json({ ok: true });
});

// Also update.sh's health check after a restart (GET /api/auth/status must answer 2xx)
router.get('/status', (req, res) => {
  res.json({ authenticated: adminSession.isLoggedIn(req) });
});

module.exports = router;
