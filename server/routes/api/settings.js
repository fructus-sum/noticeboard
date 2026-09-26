const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const configService = require('../../services/configService');
const updateService = require('../../services/updateService');
const { lanInterfaces } = require('../../utils/networkInfo');
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

// This Pi's IP and MAC addresses, for the admin home page
router.get('/device', (req, res) => {
  res.json({ interfaces: lanInterfaces() });
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

// ── Software updates ──────────────────────────────────────────────────────────
// Switching branch: check the branch, then the admin password (which gives a one-time token),
// then a final confirmation with that token. installers/update.sh does the actual update.

// Answers with the admin-facing message of an updateService error; anything else is a 500
function updateRoute(handler) {
  return async (req, res, next) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      if (err.expose) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

// Wrong passwords only (403s) count: 5 per 15 minutes, like logging in
const updatePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 403,
  message: { error: 'Too many wrong passwords. Nothing was changed. Try again in 15 minutes.' },
});

router.get('/updates', updateRoute(() => updateService.getInfo()));

router.get('/updates/branches', updateRoute(async () => ({ branches: await updateService.listBranches() })));

router.post('/updates/check', updateRoute(async (req) => {
  const [result, info] = await Promise.all([updateService.checkBranch(req.body.branch), updateService.getInfo()]);
  return { ...result, current: info.branch, currentCommit: info.commit };
}));

router.post('/updates/verify-password', updatePasswordLimiter, async (req, res, next) => {
  try {
    const { password, branch } = req.body;
    if (!updateService.validBranchName(branch)) {
      return res.status(400).json({ error: "That isn't a valid branch name." });
    }
    const match = typeof password === 'string' && password !== ''
      && await bcrypt.compare(password, configService.get('passwordHash'));
    if (!match) {
      logger.warn('Branch switch: wrong password', { ip: req.ip, branch });
      // 403, not 401: a 401 would send the admin panel to the login page
      return res.status(403).json({ error: 'Incorrect password. The switch was cancelled and nothing was changed.' });
    }
    res.json({ token: updateService.issueToken(branch) });
  } catch (err) {
    next(err);
  }
});

router.post('/updates/switch', updateRoute(async (req) => {
  const { branch, token } = req.body;
  if (!updateService.takeToken(token, branch)) {
    throw Object.assign(new Error('The password check has expired. Nothing was changed; start the switch again.'), { status: 403, expose: true });
  }
  return updateService.requestSwitch(branch, req.ip);
}));

module.exports = router;
