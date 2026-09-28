// server/services/displaySettings.js — what every display needs to know about its own look and state
//
// Responsibilities
//   The one place that puts the display:settings payload together: the location pin (config), the
//   logo and the background colour (brandingService), and whether the installer needs running
//   again on the Server (services/updates/installerVersion) or, with manual updates, a new version is
//   waiting (services/updates): the viewer shows either as its warning mark. Both are read from
//   files, so they're kept here and checked again with refresh(): the installer writes its record
//   after it has restarted the server, an update can raise the version needed, and update.sh
//   records a waiting version.
//
// Provides
//   current() → { showDeviceInfo, logo: { url } | null, background, installerNeeded, updateAvailable,
//               restartNeeded }
//   refresh() → Promise: reads the installer and update states again (on an error, keeps the last)
//
// Used by
//   realtime/displaySocket (sends current() on connect and broadcasts it when it changes)
//
// Uses
//   services/configService (display.showDeviceInfo), services/brandingService (the logo URL and
//   the background colour), services/updates/installerVersion (status), services/updates
//   (manualUpdateWaiting), services/restartState (restartNeeded), utils/logger
//
// Change impact
//   The payload is a contract with open screens (SYSTEM_DESIGN §3.4, §15): keys may be added,
//   never removed or changed, because a screen runs its old viewer until it reloads.
const configService = require('./configService');
const brandingService = require('./brandingService');
const installerVersion = require('./updates/installerVersion');
const updates = require('./updates');
const restartState = require('./restartState');
const logger = require('../utils/logger');

let installerNeeded = false;
let updateAvailable = false;   // manual updates, and a new version waiting (SYSTEM_DESIGN §14 D41)

function current() {
  return {
    showDeviceInfo: configService.get('display')?.showDeviceInfo !== false,
    logo: brandingService.logoEnabled() ? { url: `/branding/logo?v=${brandingService.logoVersion()}` } : null,
    background: brandingService.backgroundColour(),
    installerNeeded,
    updateAvailable,
    // A setting that takes effect only after a restart (the port) was changed: the warning mark
    restartNeeded: restartState.status().restartNeeded,
  };
}

async function refresh() {
  try {
    installerNeeded = (await installerVersion.status()).needed === true;
  } catch (err) {
    logger.warn('Display settings: could not read the installer state', { err: err.message });
  }
  try {
    updateAvailable = await updates.manualUpdateWaiting();
  } catch (err) {
    logger.warn('Display settings: could not read the update state', { err: err.message });
  }
}

module.exports = { current, refresh };
