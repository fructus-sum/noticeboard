// server/routes/api/settings/general.js — the settings themselves, and the devices involved
//
// Responsibilities
//   GET /           the settings (no secrets); PUT / applies a change (settingsService)
//   GET /device     this server's network interfaces with their MAC addresses
//   GET /my-device  whether the admin's own device is local, and its MAC (for the MAC-filter warning)
//
// Used by
//   routes/api/settings/index.js; the admin panel (SettingsView, the cards, MacFilterWarning)
//
// Uses
//   services/settingsService, utils/network, middleware/asyncRoute, utils/logger
const express = require('express');
const settingsService = require('../../../services/settingsService');
const { route } = require('../../../middleware/asyncRoute');
const { lanInterfaces } = require('../../../utils/network');
const logger = require('../../../utils/logger');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(settingsService.publicSettings());
});

router.put('/', route(async (req, res) => {
  const result = await settingsService.applyPatch(req.body);
  if (result.error) return res.status(result.status).json({ error: result.error });
  logger.info('Settings updated', { keys: result.keys });
  res.json(result.settings);
}));

// The Server's IP and MAC addresses, for the admin home page
router.get('/device', (req, res) => {
  res.json({ interfaces: lanInterfaces() });
});

// The MAC address of the device using the admin panel, as the server sees it, for the warning
// when MAC filtering is turned on. null if it can't be found (e.g. across a router); local:
// the admin panel is open on the Server itself, which is always allowed.
router.get('/my-device', (req, res) => {
  const local = req.clientMac === 'localhost';
  res.json({ local, mac: local ? null : req.clientMac || null });
});

module.exports = router;
