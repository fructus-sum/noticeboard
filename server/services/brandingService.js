// server/services/brandingService.js — the logo, and what each display needs to know about its own look
//
// Provides
//   saveLogo(path), removeLogo(), hasCustomLogo(), placeholderLogo() (the placeholder, scaled once
//   per version), logoVersion() (changes with the logo, for cache-busting), MAX_SIZE (500)
//   logoEnabled()     whether the logo is shown (Settings → Branding)
//   backgroundColour() → the viewer's background colour: the saved one, else the default
//
// Used by
//   routes/index.js (/branding/logo), routes/api/settings/logo.js, services/displaySettings
//
// Uses
//   sharp, services/configService (display settings), utils/pathHelpers, shared/contract.json
//   (the default background and the colour's form)
//
// Change impact
//   The logo URL and the colour go to open screens in the display:settings payload
//   (services/displaySettings; SYSTEM_DESIGN §15).
const fs = require('fs');
const sharp = require('sharp');
const configService = require('./configService');
const { brandingDir, logoPath, defaultLogoPath } = require('../utils/pathHelpers');
const { display: DISPLAY } = require('../../shared/contract.json');

// The logo, shown above "No slideshow published" on the displays and above the title in the
// admin sidebar. An uploaded logo replaces the placeholder that ships in sample-data/.
// Either way it is at most 500 × 500 px: scaled down to fit by its larger side, never
// stretched and never enlarged.
const MAX_SIZE = 500;

function fitLogo(input) {
  return sharp(input)
    .rotate()   // honour the photo's orientation
    .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
    .png();
}

function hasCustomLogo() {
  return fs.existsSync(logoPath());
}

// Save an uploaded image as the logo. Checked and converted before anything is replaced.
async function saveLogo(inputPath) {
  const buffer = await fitLogo(inputPath).toBuffer();
  fs.mkdirSync(brandingDir(), { recursive: true });
  const tmp = `${logoPath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, logoPath());
  return sharp(buffer).metadata();
}

function removeLogo() {
  fs.rmSync(logoPath(), { force: true });
}

// The placeholder, scaled once per version of the file
let placeholder = { mtime: 0, buffer: null };
async function placeholderLogo() {
  const { mtimeMs } = fs.statSync(defaultLogoPath());
  if (placeholder.mtime !== mtimeMs) {
    placeholder = { mtime: mtimeMs, buffer: await fitLogo(defaultLogoPath()).toBuffer() };
  }
  return placeholder.buffer;
}

// Changes whenever the logo does, so browsers never show an old one from their cache
function logoVersion() {
  try {
    return String(Math.round(fs.statSync(hasCustomLogo() ? logoPath() : defaultLogoPath()).mtimeMs));
  } catch {
    return '0';
  }
}

function logoEnabled() {
  return configService.get('display')?.logo?.enabled !== false;
}

// Fills the screen around a slide that doesn't fill it, and behind the waiting screen
function backgroundColour() {
  const saved = configService.get('display')?.backgroundColor;
  return typeof saved === 'string' && new RegExp(DISPLAY.colourPattern).test(saved) ? saved : DISPLAY.defaultBackground;
}


module.exports = {
  MAX_SIZE,
  hasCustomLogo,
  saveLogo,
  removeLogo,
  placeholderLogo,
  logoVersion,
  logoEnabled,
  backgroundColour,
};
