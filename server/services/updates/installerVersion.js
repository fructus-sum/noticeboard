// server/services/updates/installerVersion.js — does the Server need the installer run again?
//
// Responsibilities
//   Updates can't change what only installers/install.sh sets up (kiosk scripts, system services,
//   desktop shortcuts, system packages). A version's system-requirements.json says which installer
//   version it needs (installer.version, with what each version brings); install.sh records the
//   version of every completed run in data/installer.json.
//
// Provides
//   installedVersion()          → Promise<number | null>  the last installer run's version. Servers
//                                 set up before the record existed are told apart by the kiosk
//                                 script they got (with the exit button: 1, else 0). null: not set
//                                 up by the installer (e.g. a copy on a PC): nothing to say
//   installerNeeds(list, installed) → { required, installed, needed, changes, displays }
//                                 for a version whose system-requirements.json is <list>; changes
//                                 are only the versions this Server missed; displays: Clients
//                                 need it too
//   status()                    → Promise<installerNeeds for the running version + { branch }>
//                                 (the branch the installer command should come from)
//
// Used by
//   services/updates/index.js (the branch check, the home page status), services/displaySettings.js
//   (the screens' warning mark),
//   server/test/installer.test.js
//
// Uses
//   utils/configIO, utils/pathHelpers, services/updates/updateFiles (the branch)
const fs = require('fs/promises');
const { readJsonFile } = require('../../utils/configIO');
const { installerRecordPath, serverKioskPath, requirementsPath } = require('../../utils/pathHelpers');
const { readBranchSetting } = require('./updateFiles');

async function installedVersion() {
  const record = readJsonFile(installerRecordPath());
  if (Number.isInteger(record?.version)) return record.version;
  const kiosk = await fs.readFile(serverKioskPath(), 'utf8').catch(() => null);
  if (kiosk === null) return null;
  return kiosk.includes('kiosk-exit') ? 1 : 0;
}

function installerNeeds(list, installed) {
  const required = Number.isInteger(list?.installer?.version) ? list.installer.version : 0;
  const needed = installed !== null && installed < required;
  const changes = !needed ? [] : (Array.isArray(list.installer.changes) ? list.installer.changes : [])
    .filter((c) => Number.isInteger(c?.version) && c.version > installed && c.version <= required);
  return {
    required,
    installed,
    needed,
    changes: changes.map((c) => String(c.change || '')).filter(Boolean),
    displays: changes.some((c) => c.displays === true),
  };
}

async function status() {
  const [installed, branch] = await Promise.all([installedVersion(), readBranchSetting()]);
  return { ...installerNeeds(readJsonFile(requirementsPath()), installed), branch };
}

module.exports = { installedVersion, installerNeeds, status };
