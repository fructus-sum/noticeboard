// server/services/displaySettings.js — what every display needs to know about its own look and state
//
// Responsibilities
//   The one place that puts the display:settings payload together: the location pin (config), the
//   logo and the background colour (brandingService), and whether the installer needs running
//   again on this Pi (services/updates/installerVersion), which the viewer shows as a warning mark.
//   The installer state is read from files, so it's kept here and checked again with refresh():
//   the installer writes its record after it has restarted the server, and an update can raise the
//   version needed.
//
// Provides
//   current() → { showDeviceInfo, logo: { url } | null, background, installerNeeded }
//   refresh() → Promise: reads the installer state again (on an error, keeps the last one)
//
// Used by
//   realtime/displaySocket (sends current() on connect and broadcasts it when it changes)
//
// Uses
//   services/configService (display.showDeviceInfo), services/brandingService (the logo URL and
//   the background colour), services/updates/installerVersion (status)
//
// Change impact
//   The payload is a contract with open screens (SYSTEM_DESIGN §3.4, §15): keys may be added,
//   never removed or changed, because a screen runs its old viewer until it reloads.
const configService = require('./configService');
const brandingService = require('./brandingService');
const installerVersion = require('./updates/installerVersion');
const logger = require('../utils/logger');

let installerNeeded = false;

function current() {
  return {
    showDeviceInfo: configService.get('display')?.showDeviceInfo !== false,
    logo: brandingService.logoEnabled() ? { url: `/branding/logo?v=${brandingService.logoVersion()}` } : null,
    background: brandingService.backgroundColour(),
    installerNeeded,
  };
}

async function refresh() {
  try {
    installerNeeded = (await installerVersion.status()).needed === true;
  } catch (err) {
    logger.warn('Display settings: could not read the installer state', { err: err.message });
  }
}

module.exports = { current, refresh };
