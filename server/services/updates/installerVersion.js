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
//   installerNeeds(list, installed) → { required, installed, needed, changes, displays, clientsFollow }
//                                 for a version whose system-requirements.json is <list>; changes
//                                 are only the versions this Server missed; displays: each Client
//                                 needs one run by hand too (a change for them, and this Server's
//                                 record from before CLIENTS_FOLLOW_FROM: its Clients don't follow
//                                 it yet); clientsFollow: a change for them that reaches them by
//                                 itself (SYSTEM_DESIGN §18.7 phases 3, 4)
//   status()                    → Promise<installerNeeds + { branch, ref, returning }>: for the
//                                 running version, with ref the Release's tag on main (else main,
//                                 or the followed branch) for the installer command; or, while a
//                                 Release with the followed branch's work waits for the installer
//                                 before update.sh returns to main, that Release's needs, with
//                                 ref and returning.release its tag and returning.branch the branch
//                                 (SYSTEM_DESIGN §18.6). On main with the system step set up
//                                 (automatic), needed only when its last run failed (systemFailed:
//                                 { release, message, time }, §18.7 phase 2); lastByHand: on main,
//                                 this run by hand sets the system step up (§18.7 phase 4)
//
// Used by
//   services/updates/index.js (the branch check, the home page status), services/displaySettings.js
//   (the screens' warning mark),
//   server/test/installer.test.js
//
// Uses
//   utils/configIO, utils/pathHelpers, services/updates/updateFiles (the branch, the last check),
//   ./releases (releaseAt), ./git, ./branchName; updateFiles (readSystemResult, unitsEnabled)
const fs = require('fs/promises');
const { readJsonFile } = require('../../utils/configIO');
const { installerRecordPath, serverKioskPath, requirementsPath } = require('../../utils/pathHelpers');
const { readBranchSetting, readCheck, readSystemResult, unitsEnabled } = require('./updateFiles');
const { releaseAt } = require('./releases');
const { git } = require('./git');
const { validBranchName } = require('./branchName');

async function installedVersion() {
  const record = readJsonFile(installerRecordPath());
  if (Number.isInteger(record?.version)) return record.version;
  const kiosk = await fs.readFile(serverKioskPath(), 'utf8').catch(() => null);
  if (kiosk === null) return null;
  return kiosk.includes('kiosk-exit') ? 1 : 0;
}

// The installer version that set up root's system step (§18.7 phase 2), and the one from which a
// Client only follows its Server (phase 3)
const SYSTEM_STEP_FROM = 6;
const CLIENTS_FOLLOW_FROM = 7;

function installerNeeds(list, installed) {
  const required = Number.isInteger(list?.installer?.version) ? list.installer.version : 0;
  const needed = installed !== null && installed < required;
  const changes = !needed ? [] : (Array.isArray(list.installer.changes) ? list.installer.changes : [])
    .filter((c) => Number.isInteger(c?.version) && c.version > installed && c.version <= required);
  const forClients = changes.some((c) => c.displays === true);
  return {
    required,
    installed,
    needed,
    changes: changes.map((c) => String(c.change || '')).filter(Boolean),
    displays: forClients && installed < CLIENTS_FOLLOW_FROM,
    clientsFollow: forClients && installed >= CLIENTS_FOLLOW_FROM,
  };
}

async function status() {
  const [installed, branch, lastCheck] = await Promise.all([installedVersion(), readBranchSetting(), readCheck()]);
  // A Release with the followed branch's work that waits for the installer before update.sh
  // returns to main (update-check.json's installerFor, SYSTEM_DESIGN §18.6)
  const waiting = branch !== 'main' && validBranchName(lastCheck?.installerFor) ? lastCheck.installerFor : null;
  if (waiting) {
    const text = await git(['show', `refs/tags/${waiting}:system-requirements.json`]).catch(() => null);
    let list = null;
    try { list = JSON.parse(text); } catch { /* unreadable: nothing to say about it */ }
    const needs = installerNeeds(list, installed);
    if (needs.needed) return { ...needs, branch, ref: waiting, returning: { release: waiting, branch } };
  }
  const ref = branch === 'main' ? (await releaseAt()) || 'main' : branch;
  const needs = installerNeeds(readJsonFile(requirementsPath()), installed);
  // On main with root's system step set up (installer version 6), the installer runs by itself: the
  // notice only asks for something when its last run, for a Release not running yet, didn't work
  // (SYSTEM_DESIGN §18.7 phase 2)
  const [units, result, head] = await Promise.all([
    unitsEnabled(), readSystemResult(), git(['rev-parse', 'HEAD']).catch(() => null),
  ]);
  const automatic = branch === 'main' && units.system;
  const systemFailed = automatic && result && result.result !== 'done' && result.commit !== head
    ? { release: result.release || null, message: String(result.message || ''), time: result.time || null } : null;
  return {
    ...needs,
    needed: (needs.needed && !automatic) || !!systemFailed,
    branch, ref, returning: null, automatic, systemFailed,
    // Not set up yet (a Server from before 0.9.0): this run by hand is the last one on main
    lastByHand: branch === 'main' && !units.system && needs.needed && needs.required >= SYSTEM_STEP_FROM,
  };
}

module.exports = { installedVersion, installerNeeds, status };
