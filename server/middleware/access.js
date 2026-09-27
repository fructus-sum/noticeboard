// server/middleware/access.js — who may reach what: approved devices, and the logged-in admin
//
// Responsibilities
//   The MAC-filter check and the admin check, written once (they were repeated in macFilter.js
//   and adminAuth.js). Denials look exactly as they always have, because other programs rely on
//   them: a device MAC filtering blocks gets a plain-text 404 "Not Found" everywhere (the display
//   kiosk script reads a 404 as "waiting for approval"), and an admin request without a valid
//   login gets a 401 JSON error (the admin panel then shows the login page).
//
// Provides
//   requireApprovedDevice(area)   middleware: allows approved devices (all of them while MAC
//                                 filtering is off; always this Pi itself), else 404. Sets
//                                 req.clientMac. area names the log lines ("Display", "Admin")
//   requireAdmin                  middleware: requireApprovedDevice('Admin'), then a valid session
//                                 cookie: 401 { error: 'Not authenticated' } without one,
//                                 401 { error: 'Session expired' } (and the cookie cleared) for a
//                                 bad or expired one. Sets req.admin
//
// Used by
//   middleware/macFilter.js, middleware/adminAuth.js (the names routes use)
//
// Uses
//   services/macService (resolveRequest), services/adminSession, utils/logger
const macService = require('../services/macService');
const adminSession = require('../services/adminSession');
const logger = require('../utils/logger');

// The log line when resolving the device fails, as each check has always written it
const ERROR_LOG = { Display: 'MAC filter error', Admin: 'Admin auth error' };

async function checkDevice(area, req, res) {
  let result;
  try {
    result = await macService.resolveRequest(req);
  } catch (err) {
    logger.error(ERROR_LOG[area] || `${area}: MAC check error`, { err: err.message });
    res.status(404).send('Not Found');
    return null;
  }
  const { mac, ip, approved } = result;
  if (!approved) {
    logger.warn(`${area}: MAC denied`, { ip, mac });
    res.status(404).send('Not Found');
    return null;
  }
  req.clientMac = mac;
  return result;
}

function requireApprovedDevice(area) {
  return (req, res, next) => {
    checkDevice(area, req, res).then((device) => { if (device) next(); });
  };
}

async function requireAdmin(req, res, next) {
  const device = await checkDevice('Admin', req, res);
  if (!device) return;
  const token = adminSession.tokenOf(req);
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    req.admin = adminSession.verifyToken(token);
  } catch (err) {
    logger.warn('Admin: JWT invalid', { ip: device.ip, err: err.message });
    adminSession.clear(res);
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
}

module.exports = { requireApprovedDevice, requireAdmin };
