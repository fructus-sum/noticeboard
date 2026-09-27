// server/routes/api/settings/index.js — /api/settings: everything on the admin panel's Settings page
//
// Each part defines its own paths under /api/settings (they don't overlap). The admin check is
// applied once, where this is mounted (routes/api/index.js).
//   general.js    GET/PUT /, /device, /my-device
//   security.js   /security, /password
//   logo.js       /logo
//   updates.js    /updates…, /version
//   maintenance.js  /maintenance/… (Delete All)
//
// Used by
//   routes/api/index.js
const express = require('express');

const router = express.Router();
router.use(require('./general'));
router.use(require('./security'));
router.use(require('./logo'));
router.use(require('./updates'));
router.use(require('./maintenance'));

module.exports = router;
