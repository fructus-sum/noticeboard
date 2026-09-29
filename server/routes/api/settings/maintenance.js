// server/routes/api/settings/maintenance.js — actions that can't be undone: Delete All, Restore
// Defaults; restarting the Server (for a setting that needs it, SYSTEM_DESIGN §18.5 item 4); and a
// Full update (root's system step, then the code again: §18.7 phase 2)
//
// Each is: the admin password (which gives a one-time token for that action, the wrong tries
// counted with every other password check), then a final confirmation with that token.
// GET /maintenance/restart says whether the Server needs a restart ({ restartNeeded, port }).
//
// Used by
//   routes/api/settings/index.js; the admin panel (components/settings/DeleteContentCard,
//   components/settings/RestartNotice, components/updates/FullUpdate)
//
// Uses
//   services/contentReset, services/restartState, services/updates (fullUpdate), services/actionTokens,
//   services/adminPassword, middleware/asyncRoute,
//   middleware/passwordLimiter, utils/logger
//
// Change impact
//   The admin panel of the running version is the only caller.
const express = require('express');
const contentReset = require('../../../services/contentReset');
const restartState = require('../../../services/restartState');
const updateService = require('../../../services/updates');
const actionTokens = require('../../../services/actionTokens');
const adminPassword = require('../../../services/adminPassword');
const { route, jsonRoute } = require('../../../middleware/asyncRoute');
const { wrongPasswordLimiter } = require('../../../middleware/passwordLimiter');
const logger = require('../../../utils/logger');

const router = express.Router();

// The actions, each confirmed with its own token (the subject is the same for all: this noticeboard)
const ACTIONS = new Set(['delete-all', 'restore-defaults', 'restart', 'full-update']);
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

router.get('/maintenance/restart', (req, res) => {
  res.json(restartState.status());
});

// The Server stops and systemd starts it again, with the saved settings
router.post('/maintenance/restart', jsonRoute(async (req) => {
  if (!actionTokens.take(req.body?.token, 'restart', SUBJECT)) throw expired();
  restartState.requestRestart(req.ip);
  return { restarting: true, ...restartState.status().port };
}));

// A Full update (main only; services/updates says why not otherwise)
router.post('/maintenance/full-update', jsonRoute(async (req) => {
  if (!actionTokens.take(req.body?.token, 'full-update', SUBJECT)) throw expired();
  return updateService.fullUpdate(req.ip);
}));

module.exports = router;
