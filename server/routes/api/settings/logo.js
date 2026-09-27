// server/routes/api/settings/logo.js — /api/settings/logo: upload, reset and describe the logo
//
// The logo is shown above "No slideshow published" and in the admin sidebar
// (services/brandingService.js). Uploads are scaled down to fit 500 × 500, never enlarged; a
// change tells the displays (displayEvents.displaySettingsChanged).
//
// Used by
//   routes/api/settings/index.js; the admin panel (useBranding, LogoSettings)
//
// Uses
//   services/brandingService, services/displayEvents, services/mediaTypes (LOGO_MIME),
//   middleware/uploads
const express = require('express');
const fs = require('fs');
const brandingService = require('../../../services/brandingService');
const displayEvents = require('../../../services/displayEvents');
const { LOGO_MIME } = require('../../../services/mediaTypes');
const { createUpload } = require('../../../middleware/uploads');
const logger = require('../../../utils/logger');

const router = express.Router();

const logoUpload = createUpload({
  prefix: 'logo',
  maxFileBytes: 20 * 1024 * 1024,
  allowed: LOGO_MIME,
  rejectMessage: 'The logo must be a PNG, JPEG, GIF or WebP image',
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
router.post('/logo', (req, res) => {
  logoUpload(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    try {
      const { width, height } = await brandingService.saveLogo(req.file.path);
      displayEvents.displaySettingsChanged();   // displays pick up the new logo
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
  displayEvents.displaySettingsChanged();
  logger.info('Logo reset to the default');
  res.json(logoInfo());
});

module.exports = router;
