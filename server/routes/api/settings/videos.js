// server/routes/api/settings/videos.js — converting the videos already uploaded (Settings → Display)
//
// GET  /videos/convert   → how the last or running conversion is going (videoConversion.status)
// POST /videos/convert   → starts converting every video that isn't in the chosen format (409
//                          while a run is going)
//
// Used by
//   routes/api/settings/index.js; the admin panel (components/settings/DisplaySettingsCard)
//
// Uses
//   services/videoConversion, middleware/asyncRoute
const express = require('express');
const videoConversion = require('../../../services/videoConversion');
const { jsonRoute } = require('../../../middleware/asyncRoute');

const router = express.Router();

router.get('/videos/convert', jsonRoute(() => videoConversion.status()));
router.post('/videos/convert', jsonRoute(() => videoConversion.start()));

module.exports = router;
