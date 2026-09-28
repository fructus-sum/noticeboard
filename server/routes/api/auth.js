// server/routes/api/auth.js — /api/auth: logging in and out, and whether this browser is logged in
//
// Responsibilities
//   POST /login (rate limited; 401 on a wrong password), POST /logout, GET /status. Only the MAC
//   filter applies here (api/index.js).
//
// Used by
//   routes/api/index.js; the admin panel (LoginView, the router's login check, NavBar); update.sh's
//   health check (GET /status must answer 2xx after a restart)
//
// Uses
//   services/adminPassword (verify), services/adminSession (the cookie), middleware/asyncRoute,
//   utils/logger
//
// Change impact
//   GET /api/auth/status is update.sh's health check on every installed Pi: it must keep answering
//   2xx when the server is up (SYSTEM_DESIGN §15).
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
