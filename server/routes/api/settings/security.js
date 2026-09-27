// /api/settings (security): the default-password warning and changing the password
// (services/adminPassword.js)
const express = require('express');
const adminPassword = require('../../../services/adminPassword');
const { route } = require('../../../middleware/asyncRoute');
const logger = require('../../../utils/logger');

const router = express.Router();

// Whether the admin password is still the default one: the admin panel warns until it's changed
router.get('/security', route(async (req, res) => {
  res.json({ defaultPassword: await adminPassword.usesDefault() });
}));

// A wrong current password is a 403, not 401: a 401 would send the admin panel to the login page
router.put('/password', route(async (req, res) => {
  const result = await adminPassword.change(req.body.current, req.body.newPassword);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  logger.info('Admin password changed', { ip: req.ip });
  res.json({ ok: true });
}));

module.exports = router;
