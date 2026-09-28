// server/routes/api/settings/maintenance.js — actions that can't be undone: Delete All, Restore Defaults
//
// Each is: the admin password (which gives a one-time token for that action, the wrong tries
// counted with every other password check), then a final confirmation with that token.
//
// Used by
//   routes/api/settings/index.js; the admin panel (components/settings/DeleteContentCard)
//
// Uses
//   services/contentReset, services/actionTokens, services/adminPassword, middleware/asyncRoute,
//   middleware/passwordLimiter, utils/logger
//
// Change impact
//   The admin panel of the running version is the only caller.
const express = require('express');
const contentReset = require('../../../services/contentReset');
const actionTokens = require('../../../services/actionTokens');
const adminPassword = require('../../../services/adminPassword');
const { route, jsonRoute } = require('../../../middleware/asyncRoute');
const { wrongPasswordLimiter } = require('../../../middleware/passwordLimiter');
const logger = require('../../../utils/logger');

const router = express.Router();

// The actions, each confirmed with its own token (the subject is the same for all: this noticeboard)
const ACTIONS = new Set(['delete-all', 'restore-defaults']);
const SUBJECT = 'noticeboard';

const expired = () => Object.assign(
  new Error('The password check has expired. Nothing was changed; start again.'),
  { status: 403, expose: true },
);

router.post('/maintenance/verify-password', wrongPasswordLimiter, route(async (req, res) => {
  const { password, action } = req.body ?? {};
  if (!ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action.' });
  const match = typeof password === 'string' && password !== '' && await adminPassword.verify(password);
  if (!match) {
    logger.warn('Maintenance: wrong password', { ip: req.ip, action });
    // 403, not 401: a 401 would send the admin panel to the login page
    return res.status(403).json({ error: 'Incorrect password. Nothing was changed.' });
  }
  res.json({ token: actionTokens.issue(action, SUBJECT) });
}));

router.post('/maintenance/delete-all', jsonRoute(async (req) => {
  if (!actionTokens.take(req.body?.token, 'delete-all', SUBJECT)) throw expired();
  logger.info('Delete All requested', { ip: req.ip });
  return contentReset.deleteAllContent();
}));

router.post('/maintenance/restore-defaults', jsonRoute(async (req) => {
  if (!actionTokens.take(req.body?.token, 'restore-defaults', SUBJECT)) throw expired();
  return contentReset.requestRestore(req.ip);
}));

module.exports = router;
