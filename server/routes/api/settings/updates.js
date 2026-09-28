// server/routes/api/settings/updates.js — software updates: how they went, and switching branch
//
// A switch is: check the branch, then the admin password (which gives a one-time token, rate
// limited), then a final confirmation with that token. installers/update.sh does the updating.
//
// Used by
//   routes/api/settings/index.js; the admin panel (components/updates, NavBar's version)
//
// Uses
//   services/updates (every route's work), services/adminPassword, middleware/asyncRoute,
//   middleware/passwordLimiter (wrong passwords, counted with the other password checks),
//   utils/logger
//
// Change impact
//   The admin panel of the running version reads these; update.sh never calls them (it shares
//   files with the server instead: SYSTEM_DESIGN §4.2).
const express = require('express');
const updateService = require('../../../services/updates');
const adminPassword = require('../../../services/adminPassword');
const { route, jsonRoute } = require('../../../middleware/asyncRoute');
const { wrongPasswordLimiter } = require('../../../middleware/passwordLimiter');
const logger = require('../../../utils/logger');

const router = express.Router();

router.get('/updates', jsonRoute(() => updateService.getInfo()));

// The home page's notice about an automatic change of branch, until an admin closes it
router.get('/updates/notice', jsonRoute(async () => ({ notice: await updateService.getNotice() })));
router.delete('/updates/notice', jsonRoute(async (req) => {
  await updateService.dismissNotice(req.ip);
  return { ok: true };
}));

// Whether this version needs the installer run again on the Pi, for the admin home page
router.get('/updates/installer', jsonRoute(() => updateService.installerStatus()));

// The installed version, for "Last updated" in the sidebar ({ version: null } without git)
router.get('/version', jsonRoute(async () => ({ version: await updateService.versionInfo() })));

router.get('/updates/branches', jsonRoute(async () => ({ branches: await updateService.listBranches() })));

router.post('/updates/check', jsonRoute(async (req) => {
  const [result, info] = await Promise.all([updateService.checkBranch(req.body.branch), updateService.getInfo()]);
  return { ...result, current: info.branch, currentCommit: info.commit };
}));

// The update schedule, a set time for the waiting version, and Update now
router.put('/updates/schedule', jsonRoute((req) => updateService.setSchedule(req.body, req.ip)));
router.put('/updates/install-at', jsonRoute((req) => updateService.setInstallAt(req.body?.at, req.ip)));
router.post('/updates/install-now', jsonRoute((req) => updateService.installNow(req.ip)));

router.post('/updates/verify-password', wrongPasswordLimiter, route(async (req, res) => {
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
}));

router.post('/updates/switch', jsonRoute(async (req) => {
  const { branch, token } = req.body;
  if (!updateService.takeToken(token, branch)) {
    throw Object.assign(new Error('The password check has expired. Nothing was changed; start the switch again.'), { status: 403, expose: true });
  }
  return updateService.requestSwitch(branch, req.ip, { acceptMissing: req.body.acceptMissing === true });
}));

module.exports = router;
