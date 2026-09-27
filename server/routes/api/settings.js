const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const configService = require('../../services/configService');
const updateService = require('../../services/updateService');
const brandingService = require('../../services/brandingService');
const adminPassword = require('../../services/adminPassword');
const { LOGO_MIME } = require('../../services/mediaTypes');
const { route } = require('../../middleware/asyncRoute');
const { lanInterfaces } = require('../../utils/network');
const { tmpDir } = require('../../utils/pathHelpers');
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

// The MAC address of the device using the admin panel, as the server sees it, for the warning
// when MAC filtering is turned on. null if it can't be found (e.g. across a router); local:
// the admin panel is open on the server Pi itself, which is always allowed.
router.get('/my-device', (req, res) => {
  const local = req.clientMac === 'localhost';
  res.json({ local, mac: local ? null : req.clientMac || null });
});

// Checks and merges a change to the display settings, so saving one of them never drops the
// others (e.g. saving the slide duration keeps the location pin and logo settings)
function mergeDisplay(current, change) {
  if (!change || typeof change !== 'object') return { error: 'display must be an object' };
  const merged = { ...current };
  if (change.defaultSlideDurationSeconds !== undefined) {
    const seconds = Number(change.defaultSlideDurationSeconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
      return { error: 'The slide duration must be a whole number of seconds from 1 to 3600' };
    }
    merged.defaultSlideDurationSeconds = seconds;
  }
  if (change.showDeviceInfo !== undefined) merged.showDeviceInfo = change.showDeviceInfo === true;
  if (change.logo !== undefined) merged.logo = { ...current.logo, enabled: change.logo?.enabled !== false };
  return { merged };
}

router.put('/', async (req, res, next) => {
  try {
    const allowed = ['port', 'macFiltering', 'display'];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (patch.display !== undefined) {
      const { merged, error } = mergeDisplay(configService.get('display') || {}, patch.display);
      if (error) return res.status(400).json({ error });
      patch.display = merged;
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

// Whether the admin password is still the default one: the admin panel warns until it's changed
router.get('/security', route(async (req, res) => {
  res.json({ defaultPassword: await adminPassword.usesDefault() });
}));

// ── Logo ──────────────────────────────────────────────────────────────────────
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(tmpDir(), { recursive: true });
      cb(null, tmpDir());
    },
    filename: (req, file, cb) => cb(null, `logo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (LOGO_MIME.includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('The logo must be a PNG, JPEG, GIF or WebP image'), { status: 400 }));
  },
}).single('logo');

function logoInfo() {
  return {
    custom: brandingService.hasCustomLogo(),
    enabled: brandingService.logoEnabled(),
    url: `/branding/logo?v=${brandingService.logoVersion()}`,
    maxSize: brandingService.MAX_SIZE,
  };
}

router.get('/logo', (req, res) => res.json(logoInfo()));

// Upload a logo: scaled down to fit 500 × 500 (never stretched or enlarged) and saved as PNG
router.post('/logo', (req, res, next) => {
  logoUpload(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    try {
      const { width, height } = await brandingService.saveLogo(req.file.path);
      configService.emit('change');   // displays pick up the new logo
      logger.info('Logo uploaded', { width, height });
      res.json(logoInfo());
    } catch (err) {
      logger.warn('Logo upload rejected', { err: err.message });
      res.status(400).json({ error: "That file couldn't be read as an image" });
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

// Back to the placeholder logo
router.delete('/logo', (req, res) => {
  brandingService.removeLogo();
  configService.emit('change');
  logger.info('Logo reset to the default');
  res.json(logoInfo());
});

// A wrong current password is a 403, not 401: a 401 would send the admin panel to the login page
router.put('/password', route(async (req, res) => {
  const result = await adminPassword.change(req.body.current, req.body.newPassword);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  logger.info('Admin password changed', { ip: req.ip });
  res.json({ ok: true });
}));

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

// The home page's notice about an automatic change of branch, until an admin closes it
router.get('/updates/notice', updateRoute(async () => ({ notice: await updateService.getNotice() })));
router.delete('/updates/notice', updateRoute(async (req) => {
  await updateService.dismissNotice(req.ip);
  return { ok: true };
}));

// Whether this version needs the installer run again on the Pi, for the admin home page
router.get('/updates/installer', updateRoute(() => updateService.installerStatus()));

// The installed version, for "Last updated" in the sidebar ({ version: null } without git)
router.get('/version', updateRoute(async () => ({ version: await updateService.versionInfo() })));

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
    const match = typeof password === 'string' && password !== '' && await adminPassword.verify(password);
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
  return updateService.requestSwitch(branch, req.ip, { acceptMissing: req.body.acceptMissing === true });
}));

module.exports = router;
