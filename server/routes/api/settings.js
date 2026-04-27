const express = require('express');
const bcrypt = require('bcrypt');
const configService = require('../../services/configService');
const logger = require('../../utils/logger');

const router = express.Router();

const HIDDEN = new Set(['passwordHash', 'jwtSecret', '_comment']);

function sanitise(config) {
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (!HIDDEN.has(k)) out[k] = v;
  }
  return out;
}

router.get('/', (req, res) => {
  res.json(sanitise(configService.get()));
});

router.put('/', async (req, res, next) => {
  try {
    const allowed = ['port', 'macFiltering', 'display'];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    await configService.update(patch);
    logger.info('Settings updated', { keys: Object.keys(patch) });
    res.json(sanitise(configService.get()));
  } catch (err) {
    next(err);
  }
});

router.put('/password', async (req, res, next) => {
  try {
    const { current, newPassword } = req.body;
    if (!current || !newPassword) {
      return res.status(400).json({ error: 'current and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const match = await bcrypt.compare(current, configService.get('passwordHash'));
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await configService.set('passwordHash', await bcrypt.hash(newPassword, 10));
    logger.info('Admin password changed', { ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
