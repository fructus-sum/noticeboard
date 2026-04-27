const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const configService = require('../../services/configService');
const logger = require('../../utils/logger');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
});

const COOKIE = 'nb_admin_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const hash = configService.get('passwordHash');
    const match = await bcrypt.compare(password, hash);
    if (!match) {
      logger.warn('Admin login failed', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ role: 'admin' }, configService.get('jwtSecret'), { expiresIn: '7d' });
    res.cookie(COOKIE, token, COOKIE_OPTS);
    logger.info('Admin login success', { ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  const token = req.cookies[COOKIE];
  if (!token) return res.json({ authenticated: false });
  try {
    jwt.verify(token, configService.get('jwtSecret'));
    res.json({ authenticated: true });
  } catch {
    res.json({ authenticated: false });
  }
});

module.exports = router;
