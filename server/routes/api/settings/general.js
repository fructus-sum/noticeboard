// server/routes/api/settings/general.js — the settings themselves, and the devices involved
//
// Responsibilities
//   GET /           the settings (no secrets); PUT / applies a change (settingsService)
//   GET /device     this server's network interfaces with their MAC addresses
//   GET /my-device  whether the admin's own device is local, and its MAC (for the MAC-filter warning)
//   GET /config-recovery, DELETE /config-recovery   the note about an unreadable config.json
//
// Used by
//   routes/api/settings/index.js; the admin panel (SettingsView, the cards, MacFilterWarning,
//   settings/ConfigRecoveryNotice)
//
// Uses
//   services/settingsService, services/configService (recovery), utils/network,
//   middleware/asyncRoute, utils/logger
const express = require('express');
const settingsService = require('../../../services/settingsService');
const configService = require('../../../services/configService');
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

// config.json couldn't be read at start-up (SYSTEM_DESIGN §18.5 item 8): what happened, for the
// admin panel's warning; DELETE once the admin has dealt with it
router.get('/config-recovery', (req, res) => {
  res.json({ recovery: configService.recovery() });
});
router.delete('/config-recovery', (req, res) => {
  configService.dismissRecovery();
  logger.info('Config recovery note dismissed', { ip: req.ip });
  res.json({ recovery: null });
});

module.exports = router;
